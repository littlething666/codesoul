import {
	IndexConfig,
	MockSourceProvider,
	defaultIndexConfig,
	type RigExtractorKind,
	type SourceProvider,
} from "@codesoul/core"
import { MockEmbedder } from "@codesoul/embedder/mock"
import { MockGraphStore } from "@codesoul/graph-store/mock"
import type { ManifestStore } from "@codesoul/manifest-store"
import { InMemoryManifestStore } from "@codesoul/manifest-store/memory"
import type { Parser } from "@codesoul/parser"
import { MockParser } from "@codesoul/parser/mock"
import { TreeSitterParser } from "@codesoul/parser/tree-sitter"
import { MockReranker } from "@codesoul/reranker/mock"
import type { RigExtractor } from "@codesoul/rig"
import { RigDispatcher } from "@codesoul/rig/dispatcher"
import { ManualYamlRigExtractor } from "@codesoul/rig/manual-yaml"
import { MockRigExtractor } from "@codesoul/rig/mock"
import { PackageJsonRigExtractor } from "@codesoul/rig/package-json"
import { PyProjectRigExtractor } from "@codesoul/rig/pyproject"
import { SpadeCMakeRigExtractor } from "@codesoul/rig/spade-cmake"
import { MockSummarizer } from "@codesoul/summarizer/mock"
import { MockVectorStore } from "@codesoul/vector-store/mock"
import { FixtureIndexer } from "@codesoul/indexer"
import type { Indexer } from "@codesoul/indexer"

export type Phase0Deps = {
	parser: Parser
	rig: RigExtractor
	graph: MockGraphStore
	vectors: MockVectorStore
	embedder: MockEmbedder
	reranker: MockReranker
	summarizer: MockSummarizer
	manifestStore: ManifestStore
	indexer: Indexer
	sourceProvider: SourceProvider
	config: IndexConfig
}

const buildParser = (mode: IndexConfig["parser"]): Parser => {
	switch (mode) {
		case "tree-sitter":
			return new TreeSitterParser()
		case "regex":
			return new MockParser()
	}
}

const buildRigExtractor = (kind: RigExtractorKind): RigExtractor => {
	switch (kind) {
		case "package-json":
			return new PackageJsonRigExtractor()
		case "pyproject":
			return new PyProjectRigExtractor()
		case "manual":
			return new ManualYamlRigExtractor()
		case "spade":
			return new SpadeCMakeRigExtractor()
	}
}

const buildRig = (config: IndexConfig): RigExtractor => {
	if (config.rigExtractors.length === 0) {
		// Preserve legacy behavior: with no explicit extractors configured,
		// the wiring stays on the deterministic mock so existing tests and
		// dry-run smokes don't depend on filesystem layout.
		return new MockRigExtractor()
	}
	const extractors = config.rigExtractors.map(buildRigExtractor)
	return new RigDispatcher(extractors)
}

export const wirePhase0 = (
	configOverrides: Partial<IndexConfig> = {},
): Phase0Deps => {
	const config = IndexConfig.parse({
		...defaultIndexConfig(),
		...configOverrides,
	})
	const parser = buildParser(config.parser)
	const rig = buildRig(config)
	const graph = new MockGraphStore()
	const vectors = new MockVectorStore()
	const embedder = new MockEmbedder()
	const reranker = new MockReranker()
	const summarizer = new MockSummarizer()
	const manifestStore = new InMemoryManifestStore()
	const sourceProvider: SourceProvider = new MockSourceProvider()
	const indexer = new FixtureIndexer({
		parser,
		rig,
		graph,
		vectors,
		embedder,
		manifestStore,
	})
	return {
		parser,
		rig,
		graph,
		vectors,
		embedder,
		reranker,
		summarizer,
		manifestStore,
		indexer,
		sourceProvider,
		config,
	}
}
