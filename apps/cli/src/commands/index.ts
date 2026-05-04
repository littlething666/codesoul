import { InvalidArgumentError, type Command } from "commander"
import {
	EmbedderMode,
	GraphStoreMode,
	ParserMode,
	RerankerMode,
	RigExtractorKind,
	VectorStoreMode,
} from "@codesoul/core"
import type { Phase0Deps } from "../wiring.js"
import { wirePhase0 } from "../wiring.js"

type IndexOptions = {
	repoId?: string
	indexRunId?: string
	dryRun: boolean
	parser?: ParserMode
	rigExtractors?: RigExtractorKind[]
	embedder?: EmbedderMode
	reranker?: RerankerMode
	vectorStore?: VectorStoreMode
	graphStore?: GraphStoreMode
}

const parseParserMode = (value: string): ParserMode => {
	const result = ParserMode.safeParse(value)
	if (!result.success) {
		throw new InvalidArgumentError(
			"must be one of: regex, tree-sitter",
		)
	}
	return result.data
}

const parseEmbedderMode = (value: string): EmbedderMode => {
	const result = EmbedderMode.safeParse(value)
	if (!result.success) {
		throw new InvalidArgumentError("must be one of: mock, http")
	}
	return result.data
}

const parseRerankerMode = (value: string): RerankerMode => {
	const result = RerankerMode.safeParse(value)
	if (!result.success) {
		throw new InvalidArgumentError("must be one of: mock, http")
	}
	return result.data
}

const parseVectorStoreMode = (value: string): VectorStoreMode => {
	const result = VectorStoreMode.safeParse(value)
	if (!result.success) {
		throw new InvalidArgumentError("must be one of: memory, lancedb")
	}
	return result.data
}

const parseGraphStoreMode = (value: string): GraphStoreMode => {
	const result = GraphStoreMode.safeParse(value)
	if (!result.success) {
		throw new InvalidArgumentError("must be one of: memory, neo4j")
	}
	return result.data
}

const parseRigExtractorList = (value: string): RigExtractorKind[] => {
	const items = value
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
	const out: RigExtractorKind[] = []
	for (const item of items) {
		const result = RigExtractorKind.safeParse(item)
		if (!result.success) {
			throw new InvalidArgumentError(
				`unknown rig extractor: '${item}' (must be one of: package-json, pyproject, manual, spade)`,
			)
		}
		out.push(result.data)
	}
	return out
}

const rigListsEqual = (
	a: ReadonlyArray<RigExtractorKind>,
	b: ReadonlyArray<RigExtractorKind>,
): boolean => {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

export const registerIndex = (program: Command, deps: Phase0Deps): void => {
	program
		.command("index")
		.description("Index a repository (Phase 0: mocks only)")
		.argument("<repoPath>", "path to the repository")
		.option("--repo-id <id>", "explicit repo id")
		.option("--index-run-id <id>", "explicit index run id")
		.option("--dry-run", "parse and validate without persisting", false)
		.option(
			"--parser <mode>",
			"parser implementation (regex | tree-sitter)",
			parseParserMode,
		)
		.option(
			"--rig-extractors <list>",
			"comma-separated RIG extractors (package-json,pyproject,manual,spade)",
			parseRigExtractorList,
		)
		.option(
			"--embedder <mode>",
			"embedder backend (mock | http; http requires CODESOUL_EMBEDDER_URL/MODEL/REVISION)",
			parseEmbedderMode,
		)
		.option(
			"--reranker <mode>",
			"reranker backend (mock | http; http requires CODESOUL_RERANKER_URL/MODEL/REVISION)",
			parseRerankerMode,
		)
		.option(
			"--vector-store <mode>",
			"vector store backend (memory | lancedb; lancedb requires CODESOUL_VECTOR_STORE_URI)",
			parseVectorStoreMode,
		)
		.option(
			"--graph-store <mode>",
			"graph store backend (memory | neo4j; neo4j requires CODESOUL_NEO4J_URL/USER/PASSWORD)",
			parseGraphStoreMode,
		)
		.action(async (repoPath: string, opts: IndexOptions) => {
			const parserChanged =
				opts.parser !== undefined && opts.parser !== deps.config.parser
			const rigChanged =
				opts.rigExtractors !== undefined &&
				!rigListsEqual(opts.rigExtractors, deps.config.rigExtractors)
			const embedderChanged =
				opts.embedder !== undefined &&
				opts.embedder !== deps.config.embedder
			const rerankerChanged =
				opts.reranker !== undefined &&
				opts.reranker !== deps.config.reranker
			const vectorStoreChanged =
				opts.vectorStore !== undefined &&
				opts.vectorStore !== deps.config.vectorStore
			const graphStoreChanged =
				opts.graphStore !== undefined &&
				opts.graphStore !== deps.config.graphStore
			const active =
				parserChanged ||
				rigChanged ||
				embedderChanged ||
				rerankerChanged ||
				vectorStoreChanged ||
				graphStoreChanged
					? wirePhase0({
							parser: opts.parser ?? deps.config.parser,
							rigExtractors:
								opts.rigExtractors ?? deps.config.rigExtractors,
							embedder: opts.embedder ?? deps.config.embedder,
							reranker: opts.reranker ?? deps.config.reranker,
							vectorStore:
								opts.vectorStore ?? deps.config.vectorStore,
							graphStore:
								opts.graphStore ?? deps.config.graphStore,
						})
					: deps

			const result = await active.indexer.indexRepository({
				repoPath,
				repoId: opts.repoId ?? "repo_fixture",
				indexRunId: opts.indexRunId ?? "run_phase0",
				dryRun: opts.dryRun,
			})

			console.log(
				JSON.stringify(
					{
						status: result.manifest.status,
						batchId: result.manifest.batchId,
						parser: active.config.parser,
						rigExtractors: active.config.rigExtractors,
						embedder: active.config.embedder,
						reranker: active.config.reranker,
						vectorStore: active.config.vectorStore,
						graphStore: active.config.graphStore,
						nodes: result.nodeCount,
						edges: result.edgeCount,
						vectors: result.vectorCount,
					},
					null,
					2,
				),
			)
		})
}
