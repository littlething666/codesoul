import { describe, expect, it } from "vitest"
import {
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
} from "@codesoul/core"
import {
	EDGE_TYPES,
	fromEdgeProps,
	fromNodeProps,
	toEdgeProps,
	toNodeProps,
} from "../cypher-mapping.js"

const SYM = (c: string) => `sym_${c.repeat(40)}`
const CNT = (c: string) => `cnt_${c.repeat(40)}`

const baseNode = {
	id: SYM("a"),
	contentHash: CNT("a"),
	repoId: "r",
	indexRunId: "run_t",
	batchId: "batch_t",
	sourcePath: "src/x.ts",
	schemaVersion: 1 as const,
	path: "src/x.ts",
	kind: "Function" as const,
	language: "typescript" as const,
	qualifiedName: "src/x.ts::greet",
	signature: "greet(name: string)",
	evidence: { startLine: 5, endLine: 12 },
}

const baseEdge = {
	src: SYM("a"),
	dst: SYM("b"),
	type: "CALLS" as const,
	contentHash: CNT("a"),
	repoId: "r",
	indexRunId: "run_t",
	batchId: "batch_t",
	sourcePath: "src/x.ts",
	schemaVersion: 1 as const,
}

describe("EDGE_TYPES", () => {
	it("matches the closed EdgeType set from @codesoul/core", () => {
		expect([...EDGE_TYPES].sort()).toEqual(
			[
				"CALLS",
				"CONTAINS",
				"DECLARED_BY",
				"DEFINED_IN",
				"DEPENDS_ON",
				"EXTENDS",
				"IMPLEMENTS",
				"IMPORTS",
			].sort(),
		)
	})
})

describe("toNodeProps / fromNodeProps", () => {
	it("flattens evidence into start/end columns", () => {
		const node = GraphNodeSchema.parse(baseNode)
		const props = toNodeProps(node)
		expect(props.evidenceStartLine).toBe(5)
		expect(props.evidenceEndLine).toBe(12)
		expect("evidence" in props).toBe(false)
	})

	it("round-trips back to a structurally equal GraphNode", () => {
		const node = GraphNodeSchema.parse(baseNode)
		const props = toNodeProps(node)
		const back = fromNodeProps({ ...props })
		expect(back).toEqual(node)
	})

	it("validates the reconstructed node against GraphNode", () => {
		const node = GraphNodeSchema.parse(baseNode)
		const props = toNodeProps(node)
		expect(() => fromNodeProps({ ...props })).not.toThrow()
	})

	it("coerces stringified line numbers (defensive against driver shape)", () => {
		const node = GraphNodeSchema.parse(baseNode)
		const props = toNodeProps(node) as unknown as Record<string, unknown>
		const tampered = {
			...props,
			evidenceStartLine: "5",
			evidenceEndLine: "12",
		}
		const back = fromNodeProps(tampered)
		expect(back.evidence).toEqual({ startLine: 5, endLine: 12 })
	})
})

describe("toEdgeProps / fromEdgeProps", () => {
	it("round-trips an edge without attributes", () => {
		const edge = GraphEdgeSchema.parse(baseEdge)
		const props = toEdgeProps(edge)
		expect("__attrJson" in props).toBe(false)
		const back = fromEdgeProps(props, edge.src, edge.dst, edge.type)
		expect(back).toEqual(edge)
	})

	it("round-trips an edge with attributes via __attrJson", () => {
		const edge = GraphEdgeSchema.parse({
			...baseEdge,
			attributes: { weight: 1.5, label: "hot", final: true },
		})
		const props = toEdgeProps(edge)
		expect(typeof props.__attrJson).toBe("string")
		const back = fromEdgeProps(props, edge.src, edge.dst, edge.type)
		expect(back).toEqual(edge)
	})

	it("silently drops a malformed __attrJson instead of throwing", () => {
		const edge = GraphEdgeSchema.parse(baseEdge)
		const props = toEdgeProps(edge)
		const tampered = { ...props, __attrJson: "<not json>" }
		const back = fromEdgeProps(
			tampered,
			edge.src,
			edge.dst,
			edge.type,
		)
		expect(back.attributes).toBeUndefined()
	})

	it("filters non-primitive attribute values from the JSON blob", () => {
		const edge = GraphEdgeSchema.parse(baseEdge)
		const props = toEdgeProps(edge)
		const tampered = {
			...props,
			__attrJson: JSON.stringify({
				ok: "yes",
				nested: { drop: true },
				arr: [1, 2, 3],
			}),
		}
		const back = fromEdgeProps(
			tampered,
			edge.src,
			edge.dst,
			edge.type,
		)
		expect(back.attributes).toEqual({ ok: "yes" })
	})
})
