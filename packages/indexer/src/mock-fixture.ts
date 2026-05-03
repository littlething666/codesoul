import { createHash } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import { extname, join, relative } from "node:path"
import type {
	BatchManifest,
	EmbeddingResult,
	Language,
	VectorRow,
} from "@codesoul/core"
import { BatchManifest as BatchManifestSchema } from "@codesoul/core"
import type { ManifestStore } from "@codesoul/manifest-store"
import { InMemoryManifestStore } from "@codesoul/manifest-store/memory"
import { buildBatch, type BuildBatchFile } from "./build-batch.js"
import { CryptoIdGen, type IdGen } from "./idgen.js"
import type {
	IndexRepositoryInput,
	IndexRepositoryResult,
	Indexer,
	IndexerDeps,
} from "./indexer.js"
import { type Clock, SystemClock } from "./time.js"

const LANG_BY_EXT: Record<string, Language> = {
	".ts": "typescript",
	".tsx": "typescript",
	".mts": "typescript",
	".cts": "typescript",
	".js": "javascript",
	".jsx": "javascript",
	".mjs": "javascript",
	".cjs": "javascript",
	".py": "python",
}

const SKIP_DIRS = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	".turbo",
	".next",
	"coverage",
	".venv",
	"__pycache__",
])

const walk = async (dir: string, out: string[]): Promise<void> => {
	try {
		const entries = await readdir(dir, { withFileTypes: true })
		for (const e of entries) {
			if (e.name.startsWith(".")) continue
			const full = join(dir, e.name)
			if (e.isDirectory()) {
				if (SKIP_DIRS.has(e.name)) continue
				await walk(full, out)
			} else if (e.isFile()) {
				out.push(full)
			}
		}
	} catch {
		return
	}
}

const checksum = (parts: ReadonlyArray<string>): string => {
	const h = createHash("sha256")
	for (const p of parts) {
		h.update(p)
		h.update("\u0000")
	}
	return h.digest("hex")
}

const sha1 = (text: string): string =>
	createHash("sha1").update(text).digest("hex")

type SourceFileDigest = {
	relativePath: string
	sha1: string
}

/**
 * Hash the (relativePath, fileSha1) tuples sorted by relativePath.
 *
 * Hashing only the absolute repo path (the prior behavior) was wrong:
 * the manifest hash should change when file contents change and remain
 * stable when the repo is moved. This function is now defined entirely
 * in terms of relative paths and content digests.
 */
const sourceTreeContentHash = (
	files: ReadonlyArray<SourceFileDigest>,
): string => {
	const sorted = [...files].sort((a, b) =>
		a.relativePath.localeCompare(b.relativePath),
	)
	const h = createHash("sha1")
	for (const f of sorted) {
		h.update(f.relativePath)
		h.update("\u0000")
		h.update(f.sha1)
		h.update("\u0000")
	}
	return `cnt_${h.digest("hex")}`
}

export type FixtureIndexerDeps = IndexerDeps & {
	clock?: Clock
	idGen?: IdGen
	/**
	 * Durable manifest/WAL store. If omitted, a fresh in-memory
	 * ManifestStore is created using the provided clock so that the
	 * `recordBatch` event timestamps and the `transitionBatch`
	 * `committedAt` stamp share a single time source.
	 */
	manifestStore?: ManifestStore
}

/**
 * FixtureIndexer drives the Phase 0/0.5 mock pipeline end-to-end and
 * persists every batch through `@codesoul/manifest-store`:
 *
 *   1. Parse + buildBatch (counts known)
 *   2. recordBatch(pending) — durable, with the creation event row
 *   3. Persist nodes / edges / vectors (skipped on dryRun)
 *   4. transitionBatch -> committed (or dry_run)
 *
 * If step 3 throws, the batch is transitioned to `failed` and the error
 * is rethrown so the WAL is never left ambiguous.
 */
export class FixtureIndexer implements Indexer {
	private readonly clock: Clock
	private readonly idGen: IdGen
	private readonly manifestStore: ManifestStore

	constructor(private readonly deps: FixtureIndexerDeps) {
		this.clock = deps.clock ?? SystemClock
		this.idGen = deps.idGen ?? CryptoIdGen
		this.manifestStore =
			deps.manifestStore ?? new InMemoryManifestStore({ clock: this.clock })
	}

	async indexRepository(
		input: IndexRepositoryInput,
	): Promise<IndexRepositoryResult> {
		const batchId = this.idGen.batchId()
		const startedAt = this.clock.nowIso()

		await stat(input.repoPath)
		await this.deps.rig.extract(input.repoPath)

		const filePaths: string[] = []
		await walk(input.repoPath, filePaths)
		filePaths.sort()

		const loaded: BuildBatchFile[] = []
		const digests: SourceFileDigest[] = []
		for (const filePath of filePaths) {
			const ext = extname(filePath).toLowerCase()
			const language = LANG_BY_EXT[ext]
			if (!language) continue
			if (!this.deps.parser.languages.includes(language)) continue
			const source = await readFile(filePath, "utf8")
			const relPath = relative(input.repoPath, filePath)
				.split(/[\\/]/)
				.join("/")
			loaded.push({ path: relPath, language, source })
			digests.push({ relativePath: relPath, sha1: sha1(source) })
		}

		const { nodes, edges, vectorInputs } = await buildBatch(this.deps.parser, {
			repoId: input.repoId,
			indexRunId: input.indexRunId,
			batchId,
			files: loaded,
		})

		const allVectors: VectorRow[] = []
		if (vectorInputs.length > 0) {
			const embeds = await this.deps.embedder.embed(vectorInputs)
			const byNode = new Map<string, EmbeddingResult>()
			for (const e of embeds) {
				if (e.inputKind === "node" && e.nodeId) byNode.set(e.nodeId, e)
			}
			for (const inp of vectorInputs) {
				if (inp.kind !== "node") continue
				const e = byNode.get(inp.nodeId)
				if (!e) continue
				const node = nodes.find((n) => n.id === inp.nodeId)
				if (!node) continue
				allVectors.push({
					nodeId: inp.nodeId,
					embeddingModel: e.embeddingModel,
					embeddingRevision: e.embeddingRevision,
					embeddingDim: e.embeddingDim,
					vector: e.vector,
					payloadKind: "FunctionSummary",
					repoId: input.repoId,
					indexRunId: input.indexRunId,
					batchId,
					sourcePath: node.path,
					contentHash: inp.contentHash,
					schemaVersion: 1,
				})
			}
		}

		// Phase 2 wiring: durable manifest/WAL.
		// Record the batch in `pending` state with final counts BEFORE
		// persisting to graph/vector stores. On any persistence failure,
		// transition to `failed` and rethrow so the WAL is never left
		// ambiguous.
		const pending: BatchManifest = BatchManifestSchema.parse({
			batchId,
			indexRunId: input.indexRunId,
			repoId: input.repoId,
			sourcePath: input.repoPath,
			sourceContentHash: sourceTreeContentHash(digests),
			status: "pending",
			nodeCount: nodes.length,
			edgeCount: edges.length,
			vectorCount: allVectors.length,
			createdAt: startedAt,
			committedAt: null,
			checksum: checksum([
				String(nodes.length),
				String(edges.length),
				String(allVectors.length),
			]),
			schemaVersion: 1,
		})
		await this.manifestStore.recordBatch(pending)

		try {
			if (!input.dryRun) {
				await this.deps.graph.upsertNodes(nodes)
				await this.deps.graph.upsertEdges(edges)
				await this.deps.vectors.upsert(allVectors)
			}
			const finalManifest = await this.manifestStore.transitionBatch({
				batchId,
				toStatus: input.dryRun ? "dry_run" : "committed",
			})
			return {
				manifest: finalManifest,
				nodeCount: nodes.length,
				edgeCount: edges.length,
				vectorCount: allVectors.length,
			}
		} catch (err) {
			try {
				await this.manifestStore.transitionBatch({
					batchId,
					toStatus: "failed",
					message: err instanceof Error ? err.message : String(err),
				})
			} catch {
				// Best effort; preserve and rethrow the original error.
			}
			throw err
		}
	}
}
