import type {
	EmbedInput,
	GraphEdge,
	GraphNode,
	Language,
} from "@codesoul/core"
import type { Parser } from "@codesoul/parser"

export type BuildBatchFile = {
	path: string
	language: Language
	source: string
}

export type BuildBatchInput = {
	repoId: string
	indexRunId: string
	batchId: string
	files: ReadonlyArray<BuildBatchFile>
}

export type BuildBatchResult = {
	nodes: GraphNode[]
	edges: GraphEdge[]
	vectorInputs: EmbedInput[]
}

/**
 * Pure (filesystem-free) batch builder used to make indexer tests deterministic.
 *
 * Given files already loaded into memory, parses each one and emits the nodes,
 * edges, and EmbedInput payloads that should be persisted in this batch.
 */
export const buildBatch = async (
	parser: Parser,
	input: BuildBatchInput,
): Promise<BuildBatchResult> => {
	const nodes: GraphNode[] = []
	const edges: GraphEdge[] = []
	const vectorInputs: EmbedInput[] = []

	for (const f of input.files) {
		if (!parser.languages.includes(f.language)) continue
		const result = await parser.parseFile({
			repoId: input.repoId,
			indexRunId: input.indexRunId,
			batchId: input.batchId,
			path: f.path,
			language: f.language,
			source: f.source,
		})
		nodes.push(...result.nodes)
		edges.push(...result.edges)
		for (const n of result.nodes) {
			if (n.kind === "Function" || n.kind === "Method" || n.kind === "Class") {
				vectorInputs.push({
					nodeId: n.id,
					contentHash: n.contentHash,
					payloadKind: "FunctionSummary",
					text: `${n.qualifiedName}\n${n.signature}`,
				})
			}
		}
	}

	return { nodes, edges, vectorInputs }
}
