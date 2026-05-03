import type { EdgeType, GraphEdge, GraphNode } from "@codesoul/core"
import type {
	GraphQueryResult,
	GraphStore,
	TraversalOptions,
} from "./store.js"

export class MockGraphStore implements GraphStore {
	private readonly nodes = new Map<string, GraphNode>()
	private readonly edges = new Map<string, GraphEdge>()

	async upsertNodes(nodes: ReadonlyArray<GraphNode>): Promise<void> {
		for (const n of nodes) this.nodes.set(n.id, n)
	}

	async upsertEdges(edges: ReadonlyArray<GraphEdge>): Promise<void> {
		for (const e of edges) {
			this.edges.set(`${e.src}|${e.type}|${e.dst}`, e)
		}
	}

	async getNode(id: string): Promise<GraphNode | null> {
		return this.nodes.get(id) ?? null
	}

	async neighbors(
		id: string,
		options: TraversalOptions,
	): Promise<GraphQueryResult> {
		const direction = options.direction ?? "both"
		const allowed: ReadonlySet<EdgeType> | null =
			options.edgeTypes && options.edgeTypes.length > 0
				? new Set(options.edgeTypes)
				: null

		const visited = new Set<string>([id])
		const queue: Array<{ id: string; depth: number }> = [{ id, depth: 0 }]
		const collectedNodes = new Map<string, GraphNode>()
		const collectedEdges = new Map<string, GraphEdge>()

		const start = this.nodes.get(id)
		if (start) collectedNodes.set(start.id, start)

		while (queue.length > 0) {
			const head = queue.shift()
			if (!head) break
			if (head.depth >= options.depth) continue
			for (const e of this.edges.values()) {
				if (allowed && !allowed.has(e.type)) continue
				let other: string | null = null
				if ((direction === "out" || direction === "both") && e.src === head.id) {
					other = e.dst
				} else if (
					(direction === "in" || direction === "both") &&
					e.dst === head.id
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
					queue.push({ id: other, depth: head.depth + 1 })
				}
				if (options.limit && collectedNodes.size >= options.limit) break
			}
			if (options.limit && collectedNodes.size >= options.limit) break
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
