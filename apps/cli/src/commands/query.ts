import { InvalidArgumentError, type Command } from "commander"
import { FileSystemSourceProvider } from "@codesoul/core"
import { retrieve } from "@codesoul/retrieval"
import type { Phase0Deps } from "../wiring.js"

type QueryOptions = {
	limit: number
	repo?: string
}

const parsePositiveInt = (value: string): number => {
	const n = Number(value)
	if (!Number.isInteger(n) || n <= 0) {
		throw new InvalidArgumentError("must be a positive integer")
	}
	return n
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
		.action(async (text: string, opts: QueryOptions) => {
			const sourceProvider = opts.repo
				? new FileSystemSourceProvider(opts.repo)
				: deps.sourceProvider
			const bundle = await retrieve(
				{
					graph: deps.graph,
					vectors: deps.vectors,
					embedder: deps.embedder,
					reranker: deps.reranker,
					sourceProvider,
				},
				{ query: text, limit: opts.limit },
			)
			console.log(JSON.stringify(bundle, null, 2))
		})
}
