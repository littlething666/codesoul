import type { Command } from "commander"
import type { Phase0Deps } from "../wiring.js"

type ExportOptions = {
	format: string
}

export const registerGraphExport = (
	program: Command,
	_deps: Phase0Deps,
): void => {
	const graph = program.command("graph").description("Graph operations")
	graph
		.command("export")
		.description("Export the graph as graphml or json")
		.option("--format <format>", "graphml or json", "json")
		.action(async (opts: ExportOptions) => {
			console.log(
				JSON.stringify(
					{ format: opts.format, nodes: [], edges: [] },
					null,
					2,
				),
			)
		})
}
