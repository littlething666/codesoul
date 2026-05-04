import { describe, expect, it } from "vitest"
import {
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
	stableId,
	type RigGraph,
} from "@codesoul/core"
import { materializeRigGraph } from "../rig-materialize.js"

const META = {
	repoId: "r",
	indexRunId: "run_t",
	batchId: "batch_t",
}

const emptyGraph = (): RigGraph => ({
	extractor: "test",
	extractorVersion: "0",
	components: [],
	targets: [],
	tests: [],
	schemaVersion: 1,
})

describe("materializeRigGraph", () => {
	it("returns no nodes/edges for an empty graph", () => {
		const result = materializeRigGraph(emptyGraph(), META)
		expect(result.nodes).toEqual([])
		expect(result.edges).toEqual([])
	})

	it("emits one RigComponent GraphNode per component", () => {
		const graph: RigGraph = {
			...emptyGraph(),
			components: [
				{
					id: "pkg:foo",
					name: "foo",
					kind: "package",
					path: "packages/foo",
					dependsOn: [],
				},
			],
		}
		const { nodes, edges } = materializeRigGraph(graph, META)
		expect(nodes).toHaveLength(1)
		expect(edges).toEqual([])
		const n = nodes[0]
		expect(n?.kind).toBe("RigComponent")
		expect(n?.qualifiedName).toBe("pkg:foo")
		expect(n?.signature).toBe("foo")
		expect(n?.path).toBe("packages/foo")
		expect(n?.language).toBe("unknown")
		expect(n?.id).toBe(
			stableId({
				repoId: "r",
				relativePath: "packages/foo",
				symbolKind: "RigComponent",
				qualifiedName: "pkg:foo",
			}),
		)
	})

	it("normalizes empty path to '.'", () => {
		const graph: RigGraph = {
			...emptyGraph(),
			components: [
				{
					id: "pkg:root",
					name: "root",
					kind: "workspace",
					path: "",
					dependsOn: [],
				},
			],
		}
		const { nodes } = materializeRigGraph(graph, META)
		expect(nodes[0]?.path).toBe(".")
		expect(nodes[0]?.sourcePath).toBe(".")
	})

	it("emits a DEPENDS_ON edge between components in the same graph", () => {
		const graph: RigGraph = {
			...emptyGraph(),
			components: [
				{
					id: "pkg:a",
					name: "a",
					kind: "package",
					path: "packages/a",
					dependsOn: ["pkg:b"],
				},
				{
					id: "pkg:b",
					name: "b",
					kind: "package",
					path: "packages/b",
					dependsOn: [],
				},
			],
		}
		const { nodes, edges } = materializeRigGraph(graph, META)
		expect(nodes).toHaveLength(2)
		expect(edges).toHaveLength(1)
		const aNode = nodes.find((n) => n.qualifiedName === "pkg:a")
		const bNode = nodes.find((n) => n.qualifiedName === "pkg:b")
		expect(aNode && bNode).toBeTruthy()
		if (!aNode || !bNode) return
		expect(edges[0]?.src).toBe(aNode.id)
		expect(edges[0]?.dst).toBe(bNode.id)
		expect(edges[0]?.type).toBe("DEPENDS_ON")
	})

	it("silently drops dependsOn ids that are not present in the graph", () => {
		const graph: RigGraph = {
			...emptyGraph(),
			components: [
				{
					id: "pkg:a",
					name: "a",
					kind: "package",
					path: ".",
					dependsOn: ["pkg:external"],
				},
			],
		}
		const { nodes, edges } = materializeRigGraph(graph, META)
		expect(nodes).toHaveLength(1)
		expect(edges).toEqual([])
	})

	it("emits a RigTarget GraphNode + DECLARED_BY edge to its component", () => {
		const graph: RigGraph = {
			...emptyGraph(),
			components: [
				{
					id: "pkg:a",
					name: "a",
					kind: "package",
					path: "packages/a",
					dependsOn: [],
				},
			],
			targets: [
				{
					id: "pkg:a:build",
					componentId: "pkg:a",
					name: "build",
					kind: "build",
				},
			],
		}
		const { nodes, edges } = materializeRigGraph(graph, META)
		const targetNode = nodes.find((n) => n.kind === "RigTarget")
		const componentNode = nodes.find((n) => n.kind === "RigComponent")
		expect(targetNode).toBeDefined()
		expect(componentNode).toBeDefined()
		if (!targetNode || !componentNode) return
		expect(targetNode.qualifiedName).toBe("pkg:a:build")
		expect(targetNode.path).toBe("packages/a")
		const declaredBy = edges.find((e) => e.type === "DECLARED_BY")
		expect(declaredBy).toBeDefined()
		expect(declaredBy?.src).toBe(targetNode.id)
		expect(declaredBy?.dst).toBe(componentNode.id)
	})

	it("emits a RigTest GraphNode + DECLARED_BY edge", () => {
		const graph: RigGraph = {
			...emptyGraph(),
			components: [
				{
					id: "pkg:a",
					name: "a",
					kind: "package",
					path: ".",
					dependsOn: [],
				},
			],
			tests: [
				{
					id: "pkg:a:test",
					componentId: "pkg:a",
					name: "vitest",
					framework: "vitest",
				},
			],
		}
		const { nodes, edges } = materializeRigGraph(graph, META)
		const testNode = nodes.find((n) => n.kind === "RigTest")
		expect(testNode).toBeDefined()
		expect(testNode?.signature).toBe("vitest")
		const declaredBy = edges.find((e) => e.type === "DECLARED_BY")
		expect(declaredBy).toBeDefined()
		expect(declaredBy?.src).toBe(testNode?.id)
	})

	it("skips targets/tests whose componentId is not in the graph", () => {
		const graph: RigGraph = {
			...emptyGraph(),
			targets: [
				{
					id: "pkg:missing:build",
					componentId: "pkg:missing",
					name: "build",
					kind: "build",
				},
			],
			tests: [
				{
					id: "pkg:missing:test",
					componentId: "pkg:missing",
					name: "vitest",
					framework: "vitest",
				},
			],
		}
		const { nodes, edges } = materializeRigGraph(graph, META)
		expect(nodes).toEqual([])
		expect(edges).toEqual([])
	})

	it("validates every emitted node and edge against the schemas", () => {
		const graph: RigGraph = {
			...emptyGraph(),
			components: [
				{
					id: "pkg:a",
					name: "a",
					kind: "package",
					path: ".",
					dependsOn: ["pkg:b"],
				},
				{
					id: "pkg:b",
					name: "b",
					kind: "package",
					path: "b",
					dependsOn: [],
				},
			],
			targets: [
				{
					id: "pkg:a:build",
					componentId: "pkg:a",
					name: "build",
					kind: "build",
				},
			],
			tests: [
				{
					id: "pkg:a:test",
					componentId: "pkg:a",
					name: "vitest",
					framework: "vitest",
				},
			],
		}
		const { nodes, edges } = materializeRigGraph(graph, META)
		for (const n of nodes) GraphNodeSchema.parse(n)
		for (const e of edges) GraphEdgeSchema.parse(e)
	})

	it("is deterministic on identical input", () => {
		const graph: RigGraph = {
			...emptyGraph(),
			components: [
				{
					id: "pkg:a",
					name: "a",
					kind: "package",
					path: "a",
					dependsOn: ["pkg:b"],
				},
				{
					id: "pkg:b",
					name: "b",
					kind: "package",
					path: "b",
					dependsOn: [],
				},
			],
		}
		const a = materializeRigGraph(graph, META)
		const b = materializeRigGraph(graph, META)
		expect(a).toEqual(b)
	})
})
