import { describe, expect, it } from "vitest"
import type { GraphEdge, GraphNode } from "@codesoul/core"
import { MockGraphStore } from "../mock.js"

const SYM = (c: string) => `sym_${c.repeat(40)}`
const CNT = (c: string) => `cnt_${c.repeat(40)}`

const meta = {
	repoId: "r",
	indexRunId: "run_t",
	batchId: "batch_t",
	sourcePath: "src/x.ts",
	contentHash: CNT("a"),
	schemaVersion: 1 as const,
}

const node = (id: string, qname: string, path = "src/x.ts"): GraphNode => ({
	...meta,
	id,
	path,
	kind: "Function",
	language: "typescript",
	qualifiedName: qname,
	signature: "",
	evidence: { startLine: 1, endLine: 1 },
})

const edge = (src: string, dst: string): GraphEdge => ({
	...meta,
	src,
	dst,
	type: "CALLS",
})

describe("MockGraphStore upsert", () => {
	it("is idempotent on nodes", async () => {
		const s = new MockGraphStore()
		const a = node(SYM("a"), "src/x.ts::a")
		await s.upsertNodes([a, a])
		expect(await s.getNode(a.id)).toEqual(a)
	})

	it("is idempotent on edges by (src,type,dst)", async () => {
		const s = new MockGraphStore()
		const a = node(SYM("a"), "a")
		const b = node(SYM("b"), "b")
		await s.upsertNodes([a, b])
		await s.upsertEdges([edge(a.id, b.id), edge(a.id, b.id)])
		const result = await s.neighbors(a.id, { depth: 1 })
		expect(result.edges.length).toBe(1)
	})

	it("rejects invalid nodes via Zod", async () => {
		const s = new MockGraphStore()
		const bad: unknown = { ...node(SYM("a"), "a"), kind: "Bogus" }
		await expect(s.upsertNodes([bad as GraphNode])).rejects.toThrow()
	})

	it("rejects invalid edges via Zod", async () => {
		const s = new MockGraphStore()
		const bad: unknown = { ...edge(SYM("a"), SYM("b")), type: "BOGUS" }
		await expect(s.upsertEdges([bad as GraphEdge])).rejects.toThrow()
	})
})

describe("MockGraphStore.findByQualifiedName", () => {
	it("matches exact qualified name", async () => {
		const s = new MockGraphStore()
		const a = node(SYM("a"), "src/greet.ts::greet")
		await s.upsertNodes([a])
		expect(await s.findByQualifiedName("src/greet.ts::greet")).toHaveLength(1)
	})

	it("matches suffix after ::", async () => {
		const s = new MockGraphStore()
		const a = node(SYM("a"), "src/greet.ts::greet")
		await s.upsertNodes([a])
		expect(await s.findByQualifiedName("greet")).toHaveLength(1)
	})

	it("does not match unrelated suffixes", async () => {
		const s = new MockGraphStore()
		const a = node(SYM("a"), "src/greet.ts::greet")
		await s.upsertNodes([a])
		expect(await s.findByQualifiedName("bargreet")).toHaveLength(0)
	})
})

describe("MockGraphStore.neighbors", () => {
	const setup = async () => {
		const s = new MockGraphStore()
		const a = node(SYM("a"), "a")
		const b = node(SYM("b"), "b")
		const c = node(SYM("c"), "c")
		const d = node(SYM("d"), "d")
		await s.upsertNodes([a, b, c, d])
		await s.upsertEdges([
			edge(a.id, b.id),
			edge(a.id, c.id),
			edge(b.id, d.id),
		])
		return { s, a, b, c, d }
	}

	it("depth 0 returns only the seed", async () => {
		const { s, a } = await setup()
		const r = await s.neighbors(a.id, { depth: 0 })
		expect(r.nodes.map((n) => n.id)).toEqual([a.id])
	})

	it("depth 1 returns direct out-neighbors", async () => {
		const { s, a, b, c } = await setup()
		const r = await s.neighbors(a.id, { depth: 1, direction: "out" })
		const ids = new Set(r.nodes.map((n) => n.id))
		expect(ids.has(a.id)).toBe(true)
		expect(ids.has(b.id)).toBe(true)
		expect(ids.has(c.id)).toBe(true)
	})

	it("in direction returns parents", async () => {
		const { s, a, b } = await setup()
		const r = await s.neighbors(b.id, { depth: 1, direction: "in" })
		const ids = new Set(r.nodes.map((n) => n.id))
		expect(ids.has(a.id)).toBe(true)
	})

	it("both direction returns parents and children", async () => {
		const { s, b, a, d } = await setup()
		const r = await s.neighbors(b.id, { depth: 1, direction: "both" })
		const ids = new Set(r.nodes.map((n) => n.id))
		expect(ids.has(a.id)).toBe(true)
		expect(ids.has(d.id)).toBe(true)
	})

	it("edgeTypes filters by type", async () => {
		const s = new MockGraphStore()
		const a = node(SYM("a"), "a")
		const b = node(SYM("b"), "b")
		await s.upsertNodes([a, b])
		await s.upsertEdges([{ ...edge(a.id, b.id), type: "IMPORTS" }])
		const calls = await s.neighbors(a.id, {
			depth: 1,
			edgeTypes: ["CALLS"],
		})
		expect(calls.nodes.map((n) => n.id)).toEqual([a.id])
		const imports = await s.neighbors(a.id, {
			depth: 1,
			edgeTypes: ["IMPORTS"],
		})
		expect(new Set(imports.nodes.map((n) => n.id))).toEqual(
			new Set([a.id, b.id]),
		)
	})

	it("layer-complete: finishes the current layer before applying limit", async () => {
		const { s, a, b, c } = await setup()
		// Limit is 1, but layer 1 contains both b and c (equally close).
		const r = await s.neighbors(a.id, {
			depth: 1,
			direction: "out",
			limit: 1,
		})
		const ids = new Set(r.nodes.map((n) => n.id))
		expect(ids.has(b.id)).toBe(true)
		expect(ids.has(c.id)).toBe(true)
	})
})
