import type { BatchManifest } from "@codesoul/core"
import type { Embedder } from "@codesoul/embedder"
import type { GraphStore } from "@codesoul/graph-store"
import type { Parser } from "@codesoul/parser"
import type { RigExtractor } from "@codesoul/rig"
import type { VectorStore } from "@codesoul/vector-store"

export type IndexRepositoryInput = {
	repoPath: string
	repoId: string
	indexRunId: string
	dryRun?: boolean
}

export type IndexRepositoryResult = {
	manifest: BatchManifest
	nodeCount: number
	edgeCount: number
	vectorCount: number
}

export type IndexerDeps = {
	parser: Parser
	rig: RigExtractor
	graph: GraphStore
	vectors: VectorStore
	embedder: Embedder
}

export interface Indexer {
	indexRepository(input: IndexRepositoryInput): Promise<IndexRepositoryResult>
}
