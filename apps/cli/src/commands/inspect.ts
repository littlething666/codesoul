import { InvalidArgumentError, type Command } from "commander"
import type { EdgeType, NodeKind } from "@codesoul/core"
import type { Phase0Deps } from "../wiring.js"

const parsePositiveInt = (value: string): number => {
	const n = Number(value)
	if (!Number.isInteger(n) || n <= 0) {
		throw new InvalidArgumentError("must be a positive integer")
	}
	return n
}

type NodesOptions = {
	kind?: string
	path?: string
	limit: number
}

type EdgesOptions = {
	type?: string
	limit: number
}

type VectorsOptions = {
	limit: number
	run?: string
}

export const registerInspect = (program: Command, deps: Phase0Deps): void => {
	const inspect = program
		.command("inspect")
		.description("Inspect indexed data (Phase 0/0.5: backed by mock stores)")

	inspect
		.command("nodes")
		.description("List nodes in the graph")
		.option("--kind <kind>", "filter by node kind")
		.option("--path <prefix>", "filter by path prefix")
		.option("--limit <n>", "limit results", parsePositiveInt, 50)
		.action(async (opts: NodesOptions) => {
			const nodes = await deps.graph.listNodes({
				...(opts.kind ? { kind: opts.kind as NodeKind } : {}),
				...(opts.path ? { pathPrefix: opts.path } : {}),
				limit: opts.limit,
			})
			console.log(JSON.stringify(nodes, null, 2))
		})

	inspect
		.command("edges")
		.description("List edges in the graph")
		.option("--type <type>", "filter by edge type")
		.option("--limit <n>", "limit results", parsePositiveInt, 50)
		.action(async (opts: EdgesOptions) => {
			const edges = await deps.graph.listEdges({
				...(opts.type ? { type: opts.type as EdgeType } : {}),
				limit: opts.limit,
			})
			console.log(JSON.stringify(edges, null, 2))
		})

	inspect
		.command("vectors")
		.description("List vectors for an index run")
		.option("--limit <n>", "limit results", parsePositiveInt, 10)
		.option("--run <id>", "index run id to filter by")
		.action(async (opts: VectorsOptions) => {
			if (!opts.run) {
				console.log(
					JSON.stringify(
						{
							note: "pass --run <indexRunId> to list vectors for a specific run",
						},
						null,
						2,
					),
				)
				return
			}
			const rows = await deps.vectors.listByRun(opts.run, { limit: opts.limit })
			const summary = rows.map((r) => ({
				nodeId: r.nodeId,
				payloadKind: r.payloadKind,
				embeddingModel: r.embeddingModel,
				embeddingRevision: r.embeddingRevision,
				embeddingDim: r.embeddingDim,
				sourcePath: r.sourcePath,
			}))
			console.log(JSON.stringify(summary, null, 2))
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
