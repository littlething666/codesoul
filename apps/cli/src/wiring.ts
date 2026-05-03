import type { IndexConfig } from "@codesoul/core"
import { defaultIndexConfig } from "@codesoul/core"
import { MockEmbedder } from "@codesoul/embedder/mock"
import { MockGraphStore } from "@codesoul/graph-store/mock"
import { MockParser } from "@codesoul/parser/mock"
import { MockReranker } from "@codesoul/reranker/mock"
import { MockRigExtractor } from "@codesoul/rig/mock"
import { MockSummarizer } from "@codesoul/summarizer/mock"
import { MockVectorStore } from "@codesoul/vector-store/mock"
import { FixtureIndexer } from "@codesoul/indexer"
import type { Indexer } from "@codesoul/indexer"

export type Phase0Deps = {
	parser: MockParser
	rig: MockRigExtractor
	graph: MockGraphStore
	vectors: MockVectorStore
	embedder: MockEmbedder
	reranker: MockReranker
	summarizer: MockSummarizer
	indexer: Indexer
	config: IndexConfig
}

export const wirePhase0 = (): Phase0Deps => {
	const parser = new MockParser()
	const rig = new MockRigExtractor()
	const graph = new MockGraphStore()
	const vectors = new MockVectorStore()
	const embedder = new MockEmbedder()
	const reranker = new MockReranker()
	const summarizer = new MockSummarizer()
	const indexer = new FixtureIndexer({
		parser,
		rig,
		graph,
		vectors,
		embedder,
	})
	return {
		parser,
		rig,
		graph,
		vectors,
		embedder,
		reranker,
		summarizer,
		indexer,
		config: defaultIndexConfig(),
	}
}
