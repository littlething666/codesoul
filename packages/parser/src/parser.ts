import type { GraphEdge, GraphNode, Language } from "@codesoul/core"

export type ParseResult = {
	nodes: GraphNode[]
	edges: GraphEdge[]
}

export interface Parser {
	readonly languages: ReadonlyArray<Language>
	parseFile(args: {
		repoId: string
		indexRunId: string
		batchId: string
		path: string
		language: Language
		source: string
	}): Promise<ParseResult>
}
