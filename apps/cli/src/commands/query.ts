import { InvalidArgumentError, type Command } from "commander"
import {
	EmbedderMode,
	FileSystemSourceProvider,
	GraphStoreMode,
	RerankerMode,
	VectorStoreMode,
} from "@codesoul/core"
import { retrieve } from "@codesoul/retrieval"
import type { RuntimeDeps } from "../wiring.js"
import { wireRuntime } from "../wiring.js"

type QueryOptions = {
	limit: number
	repo?: string
	embedder?: EmbedderMode
	reranker?: RerankerMode
	vectorStore?: VectorStoreMode
	graphStore?: GraphStoreMode
}

const parsePositiveInt = (value: string): number => {
	const n = Number(value)
	if (!Number.isInteger(n) || n <= 0) {
		throw new InvalidArgumentError("must be a positive integer")
	}
	return n
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

export const registerQuery = (program: Command, deps: RuntimeDeps): void => {
	program
		.command("query")
		.description("Run a hybrid retrieval query")
		.argument("<text>", "query text")
		.option("--limit <n>", "max snippets", parsePositiveInt, 10)
		.option(
			"--repo <path>",
			"repo root used to resolve snippet text (defaults to mock provider)",
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
		.action(async (text: string, opts: QueryOptions) => {
			// Warn when querying memory-backed stores (data does not survive process restarts).
			if (deps.config.graphStore === "memory" || deps.config.vectorStore === "memory") {
				console.error(
					"⚠️  Querying memory-backed stores: results come from this process only. " +
					"Use --graph-store neo4j --vector-store lancedb for persistent queries.",
				)
			}
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
				embedderChanged ||
				rerankerChanged ||
				vectorStoreChanged ||
				graphStoreChanged
					? wireRuntime({
							embedder: opts.embedder ?? deps.config.embedder,
							reranker: opts.reranker ?? deps.config.reranker,
							vectorStore:
								opts.vectorStore ?? deps.config.vectorStore,
							graphStore:
								opts.graphStore ?? deps.config.graphStore,
						})
					: deps
			const sourceProvider = opts.repo
				? new FileSystemSourceProvider(opts.repo)
				: active.sourceProvider
			const bundle = await retrieve(
				{
					graph: active.graph,
					vectors: active.vectors,
					embedder: active.embedder,
					reranker: active.reranker,
					sourceProvider,
				},
				{ query: text, limit: opts.limit },
			)
			console.log(JSON.stringify(bundle, null, 2))
		})
}
