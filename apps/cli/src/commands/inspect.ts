import type { Command } from "commander"
import type { Phase0Deps } from "../wiring.js"

export const registerInspect = (program: Command, _deps: Phase0Deps): void => {
	const inspect = program
		.command("inspect")
		.description("Inspect indexed data (Phase 0: mocks only)")

	inspect
		.command("nodes")
		.description("List nodes in the graph")
		.option("--kind <kind>", "filter by node kind")
		.option("--path <glob>", "filter by path")
		.action(async (_opts: { kind?: string; path?: string }) => {
			console.log(
				JSON.stringify(
					{ note: "nodes inspection requires an indexed graph; phase 0 stub" },
					null,
					2,
				),
			)
		})

	inspect
		.command("edges")
		.description("List edges in the graph")
		.option("--type <type>", "filter by edge type")
		.action(async () => {
			console.log(
				JSON.stringify(
					{ note: "edges inspection requires an indexed graph; phase 0 stub" },
					null,
					2,
				),
			)
		})

	inspect
		.command("vectors")
		.description("List vectors")
		.option("--limit <n>", "limit", "10")
		.action(async () => {
			console.log(
				JSON.stringify(
					{ note: "vectors inspection requires an indexed graph; phase 0 stub" },
					null,
					2,
				),
			)
		})

	inspect
		.command("query")
		.description("Inspect a query plan")
		.argument("<text>", "query text")
		.action(async (text: string) => {
			console.log(
				JSON.stringify(
					{
						query: text,
						note: "use `codesoul query <text>` for retrieval",
					},
					null,
					2,
				),
			)
		})
}
