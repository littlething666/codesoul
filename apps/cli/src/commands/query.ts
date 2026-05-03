import { InvalidArgumentError, type Command } from "commander"
import { retrieve } from "@codesoul/retrieval"
import type { Phase0Deps } from "../wiring.js"

type QueryOptions = {
	limit: number
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
		.action(async (text: string, opts: QueryOptions) => {
			const bundle = await retrieve(
				{
					graph: deps.graph,
					vectors: deps.vectors,
					embedder: deps.embedder,
					reranker: deps.reranker,
				},
				{ query: text, limit: opts.limit },
			)
			console.log(JSON.stringify(bundle, null, 2))
		})
}
