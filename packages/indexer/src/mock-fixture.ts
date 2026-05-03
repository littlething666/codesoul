import { createHash } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import { extname, join, relative } from "node:path"
import type {
	BatchManifest,
	Language,
	VectorRow,
} from "@codesoul/core"
import { BatchManifest as BatchManifestSchema } from "@codesoul/core"
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

const sourceContentHash = (repoPath: string): string =>
	`cnt_${createHash("sha1").update(repoPath).digest("hex")}`

export type FixtureIndexerDeps = IndexerDeps & {
	clock?: Clock
	idGen?: IdGen
}

export class FixtureIndexer implements Indexer {
	private readonly clock: Clock
	private readonly idGen: IdGen

	constructor(private readonly deps: FixtureIndexerDeps) {
		this.clock = deps.clock ?? SystemClock
		this.idGen = deps.idGen ?? CryptoIdGen
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
			const byNode = new Map(embeds.map((e) => [e.nodeId, e]))
			for (const inp of vectorInputs) {
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

		if (!input.dryRun) {
			await this.deps.graph.upsertNodes(nodes)
			await this.deps.graph.upsertEdges(edges)
			await this.deps.vectors.upsert(allVectors)
		}

		const manifest: BatchManifest = BatchManifestSchema.parse({
			batchId,
			indexRunId: input.indexRunId,
			repoId: input.repoId,
			sourcePath: input.repoPath,
			sourceContentHash: sourceContentHash(input.repoPath),
			status: input.dryRun ? "dry_run" : "committed",
			nodeCount: nodes.length,
			edgeCount: edges.length,
			vectorCount: allVectors.length,
			createdAt: startedAt,
			committedAt: input.dryRun ? null : this.clock.nowIso(),
			checksum: checksum([
				String(nodes.length),
				String(edges.length),
				String(allVectors.length),
			]),
			schemaVersion: 1,
		})

		return {
			manifest,
			nodeCount: nodes.length,
			edgeCount: edges.length,
			vectorCount: allVectors.length,
		}
	}
}
