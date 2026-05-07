import type { Command } from "commander"
import type { GraphNode, GraphEdge } from "@codesoul/core"
import type { RuntimeDeps } from "../wiring.js"

type ExportOptions = {
	format: string
	repoId?: string
	indexRunId?: string
}

/**
 * Sort nodes deterministically by id string comparison.
 * This ensures byte-stable output across indexing runs.
 */
const sortNodes = (nodes: GraphNode[]): GraphNode[] =>
	[...nodes].sort((a, b) => a.id.localeCompare(b.id))

/**
 * Sort edges deterministically: first by src, then type, then dst.
 */
const sortEdges = (edges: GraphEdge[]): GraphEdge[] =>
	[...edges].sort((a, b) => {
		const cmpSrc = a.src.localeCompare(b.src)
		if (cmpSrc !== 0) return cmpSrc
		const cmpType = a.type.localeCompare(b.type)
		if (cmpType !== 0) return cmpType
		return a.dst.localeCompare(b.dst)
	})

export const registerGraphExport = (
	program: Command,
	deps: RuntimeDeps,
): void => {
	const graph = program.command("graph").description("Graph operations")
	graph
		.command("export")
		.description("Export the graph as json (nodes and edges)")
		.option("--format <format>", "json (graphml planned)", "json")
		.option("--repo-id <id>", "filter by repo id")
		.option("--index-run-id <id>", "filter by index run id")
		.action(async (opts: ExportOptions) => {
			const nodes = await deps.graph.listNodes({
				...(opts.repoId ? { repoId: opts.repoId } : {}),
				...(opts.indexRunId ? { indexRunId: opts.indexRunId } : {}),
			})
			const edges = await deps.graph.listEdges({
				...(opts.repoId ? { repoId: opts.repoId } : {}),
				...(opts.indexRunId ? { indexRunId: opts.indexRunId } : {}),
			})
			const sortedNodes = sortNodes(nodes)
			const sortedEdges = sortEdges(edges)
			console.log(
				JSON.stringify(
					{
						format: opts.format,
						nodeCount: sortedNodes.length,
						edgeCount: sortedEdges.length,
						nodes: sortedNodes,
						edges: sortedEdges,
					},
					null,
					2,
				),
			)
		})
}
