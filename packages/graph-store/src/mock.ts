import type { EdgeType, GraphEdge, GraphNode } from "@codesoul/core"
import {
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
} from "@codesoul/core"
import type {
	GraphQueryResult,
	GraphStore,
	TraversalOptions,
} from "./store.js"

export class MockGraphStore implements GraphStore {
	private readonly nodes = new Map<string, GraphNode>()
	private readonly edges = new Map<string, GraphEdge>()

	async upsertNodes(nodes: ReadonlyArray<GraphNode>): Promise<void> {
		for (const raw of nodes) {
			const n = GraphNodeSchema.parse(raw)
			this.nodes.set(n.id, n)
		}
	}

	async upsertEdges(edges: ReadonlyArray<GraphEdge>): Promise<void> {
		for (const raw of edges) {
			const e = GraphEdgeSchema.parse(raw)
			this.edges.set(`${e.src}|${e.type}|${e.dst}`, e)
		}
	}

	async getNode(id: string): Promise<GraphNode | null> {
		return this.nodes.get(id) ?? null
	}

	/**
	 * Layer-complete BFS traversal.
	 *
	 * Traversal order: BFS
	 * Edge order:      insertion order (Map iteration)
	 * Layer policy:    finish the current BFS layer before applying limit
	 * Seed node:       always included
	 * Limit:           applies to discovered non-seed nodes
	 */
	async neighbors(
		id: string,
		options: TraversalOptions,
	): Promise<GraphQueryResult> {
		const direction = options.direction ?? "both"
		const allowed: ReadonlySet<EdgeType> | null =
			options.edgeTypes && options.edgeTypes.length > 0
				? new Set(options.edgeTypes)
				: null

		const start = this.nodes.get(id)
		const collectedNodes = new Map<string, GraphNode>()
		const collectedEdges = new Map<string, GraphEdge>()
		if (start) collectedNodes.set(start.id, start)

		const limit =
			options.limit && options.limit > 0
				? options.limit
				: Number.POSITIVE_INFINITY

		const visited = new Set<string>([id])
		let currentLayer: string[] = [id]
		for (let depth = 0; depth < options.depth; depth++) {
			const nextLayer: string[] = []
			for (const nodeId of currentLayer) {
				for (const e of this.edges.values()) {
					if (allowed && !allowed.has(e.type)) continue
					let other: string | null = null
					if (
						(direction === "out" || direction === "both") &&
						e.src === nodeId
					) {
						other = e.dst
					} else if (
						(direction === "in" || direction === "both") &&
						e.dst === nodeId
					) {
						other = e.src
					}
					if (other === null) continue
					collectedEdges.set(`${e.src}|${e.type}|${e.dst}`, e)
					const node = this.nodes.get(other)
					if (node && !collectedNodes.has(node.id)) {
						collectedNodes.set(node.id, node)
					}
					if (!visited.has(other)) {
						visited.add(other)
						nextLayer.push(other)
					}
				}
			}
			// Apply the limit only AFTER the current layer is fully discovered.
			const nonSeedCount = collectedNodes.size - (start ? 1 : 0)
			if (nonSeedCount >= limit) break
			currentLayer = nextLayer
			if (currentLayer.length === 0) break
		}

		return {
			nodes: Array.from(collectedNodes.values()),
			edges: Array.from(collectedEdges.values()),
		}
	}

	async findByQualifiedName(name: string): Promise<GraphNode[]> {
		return Array.from(this.nodes.values()).filter(
			(n) => n.qualifiedName === name || n.qualifiedName.endsWith(`::${name}`),
		)
	}

	async health(): Promise<{ ok: boolean; details?: string }> {
		return { ok: true }
	}
}
