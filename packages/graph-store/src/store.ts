import type { EdgeType, GraphEdge, GraphNode } from "@codesoul/core"

export type TraversalOptions = {
	depth: number
	edgeTypes?: ReadonlyArray<EdgeType>
	direction?: "out" | "in" | "both"
	limit?: number
}

export type GraphQueryResult = {
	nodes: GraphNode[]
	edges: GraphEdge[]
}

export interface GraphStore {
	upsertNodes(nodes: ReadonlyArray<GraphNode>): Promise<void>
	upsertEdges(edges: ReadonlyArray<GraphEdge>): Promise<void>
	getNode(id: string): Promise<GraphNode | null>
	neighbors(id: string, options: TraversalOptions): Promise<GraphQueryResult>
	findByQualifiedName(name: string): Promise<GraphNode[]>
	health(): Promise<{ ok: boolean; details?: string }>
}
