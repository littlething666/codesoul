import { InvalidArgumentError, type Command } from "commander"
import {
	EmbedderMode,
	FileSystemSourceProvider,
	RerankerMode,
} from "@codesoul/core"
import { retrieve } from "@codesoul/retrieval"
import type { Phase0Deps } from "../wiring.js"
import { wirePhase0 } from "../wiring.js"

type QueryOptions = {
	limit: number
	repo?: string
	embedder?: EmbedderMode
	reranker?: RerankerMode
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

export const registerQuery = (program: Command, deps: Phase0Deps): void => {
	program
		.command("query")
		.description("Run a hybrid retrieval query (Phase 0: mocks only)")
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
		.action(async (text: string, opts: QueryOptions) => {
			const embedderChanged =
				opts.embedder !== undefined &&
				opts.embedder !== deps.config.embedder
			const rerankerChanged =
				opts.reranker !== undefined &&
				opts.reranker !== deps.config.reranker
			const active =
				embedderChanged || rerankerChanged
					? wirePhase0({
							embedder: opts.embedder ?? deps.config.embedder,
							reranker: opts.reranker ?? deps.config.reranker,
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
