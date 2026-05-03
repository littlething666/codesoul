import type { EdgeType, GraphEdge, GraphNode, NodeKind } from "@codesoul/core"

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

/**
 * Filters for `GraphStore.listNodes`.
 *
 * `pathPrefix` is intentionally a literal string prefix, not a glob: real
 * adapters can implement it as `path LIKE prefix||'%'`. Glob matching, if
 * needed, can layer on top in CLI/inspection code.
 */
export type ListNodesOptions = {
	kind?: NodeKind
	pathPrefix?: string
	repoId?: string
	indexRunId?: string
	limit?: number
}

export type ListEdgesOptions = {
	type?: EdgeType
	repoId?: string
	indexRunId?: string
	limit?: number
}

/**
 * Backend-agnostic graph store contract.
 *
 * Note: `cypher`/`query(cypher)` is intentionally NOT on this interface.
 * Cypher belongs to the Neo4j adapter only; CLI inspection and retrieval
 * MUST go through `listNodes`, `listEdges`, `neighbors`, `getNode`, and
 * `findByQualifiedName` so the interface stays portable across backends
 * (Neo4j, Kuzu, in-memory mock, etc.).
 */
export interface GraphStore {
	upsertNodes(nodes: ReadonlyArray<GraphNode>): Promise<void>
	upsertEdges(edges: ReadonlyArray<GraphEdge>): Promise<void>
	getNode(id: string): Promise<GraphNode | null>
	neighbors(id: string, options: TraversalOptions): Promise<GraphQueryResult>
	findByQualifiedName(name: string): Promise<GraphNode[]>
	listNodes(options?: ListNodesOptions): Promise<GraphNode[]>
	listEdges(options?: ListEdgesOptions): Promise<GraphEdge[]>
	health(): Promise<{ ok: boolean; details?: string }>
}
