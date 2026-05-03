import { createHash, randomBytes } from "node:crypto"
import { readFile, readdir, stat } from "node:fs/promises"
import { extname, join, relative } from "node:path"
import type {
	BatchManifest,
	GraphEdge,
	GraphNode,
	Language,
	VectorRow,
} from "@codesoul/core"
import type {
	IndexRepositoryInput,
	IndexRepositoryResult,
	Indexer,
	IndexerDeps,
} from "./indexer.js"

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

export class FixtureIndexer implements Indexer {
	constructor(private readonly deps: IndexerDeps) {}

	async indexRepository(
		input: IndexRepositoryInput,
	): Promise<IndexRepositoryResult> {
		const batchId = `batch_${randomBytes(8).toString("hex")}`
		const startedAt = new Date().toISOString()

		await stat(input.repoPath)
		await this.deps.rig.extract(input.repoPath)

		const files: string[] = []
		await walk(input.repoPath, files)
		files.sort()

		const allNodes: GraphNode[] = []
		const allEdges: GraphEdge[] = []
		const allVectors: VectorRow[] = []

		for (const filePath of files) {
			const ext = extname(filePath).toLowerCase()
			const language = LANG_BY_EXT[ext]
			if (!language) continue
			if (!this.deps.parser.languages.includes(language)) continue
			const source = await readFile(filePath, "utf8")
			const relPath = relative(input.repoPath, filePath)
				.split(/[\\/]/)
				.join("/")
			const result = await this.deps.parser.parseFile({
				repoId: input.repoId,
				indexRunId: input.indexRunId,
				batchId,
				path: relPath,
				language,
				source,
			})
			allNodes.push(...result.nodes)
			allEdges.push(...result.edges)

			const embeddable = result.nodes.filter(
				(n) => n.kind === "Function" || n.kind === "Method" || n.kind === "Class",
			)
			if (embeddable.length === 0) continue
			const embeds = await this.deps.embedder.embed(
				embeddable.map((n) => ({
					nodeId: n.id,
					contentHash: n.contentHash,
					payloadKind: "FunctionSummary" as const,
					text: `${n.qualifiedName}\n${n.signature}`,
				})),
			)
			const byNode = new Map(embeds.map((e) => [e.nodeId, e]))
			for (const n of embeddable) {
				const e = byNode.get(n.id)
				if (!e) continue
				allVectors.push({
					nodeId: n.id,
					embeddingModel: e.embeddingModel,
					embeddingRevision: e.embeddingRevision,
					embeddingDim: e.embeddingDim,
					vector: e.vector,
					payloadKind: "FunctionSummary",
					repoId: input.repoId,
					indexRunId: input.indexRunId,
					batchId,
					sourcePath: relPath,
					contentHash: n.contentHash,
					schemaVersion: 1,
				})
			}
		}

		if (!input.dryRun) {
			await this.deps.graph.upsertNodes(allNodes)
			await this.deps.graph.upsertEdges(allEdges)
			await this.deps.vectors.upsert(allVectors)
		}

		const manifest: BatchManifest = {
			batchId,
			indexRunId: input.indexRunId,
			repoId: input.repoId,
			sourcePath: input.repoPath,
			sourceContentHash: sourceContentHash(input.repoPath),
			status: input.dryRun ? "pending" : "committed",
			nodeCount: allNodes.length,
			edgeCount: allEdges.length,
			vectorCount: allVectors.length,
			createdAt: startedAt,
			committedAt: input.dryRun ? null : new Date().toISOString(),
			checksum: checksum([
				String(allNodes.length),
				String(allEdges.length),
				String(allVectors.length),
			]),
			schemaVersion: 1,
		}

		return {
			manifest,
			nodeCount: allNodes.length,
			edgeCount: allEdges.length,
			vectorCount: allVectors.length,
		}
	}
}
