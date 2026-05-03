import { describe, expect, it } from "vitest"
import type { VectorRow } from "@codesoul/core"
import { EMBEDDING_DIM } from "@codesoul/core"
import { MockVectorStore } from "../mock.js"

const SYM = (c: string) => `sym_${c.repeat(40)}`
const CNT = (c: string) => `cnt_${c.repeat(40)}`

const row = (
	nodeId: string,
	payloadKind: VectorRow["payloadKind"] = "FunctionSummary",
	vector: number[] = new Array(EMBEDDING_DIM).fill(0),
	overrides: Partial<VectorRow> = {},
): VectorRow => ({
	repoId: "r",
	indexRunId: "run_t",
	batchId: "batch_t",
	sourcePath: "src/x.ts",
	contentHash: CNT("a"),
	schemaVersion: 1,
	nodeId,
	embeddingModel: "mock-embedder",
	embeddingRevision: "0",
	embeddingDim: EMBEDDING_DIM,
	vector,
	payloadKind,
	...overrides,
})

describe("MockVectorStore", () => {
	it("upserts and counts by run", async () => {
		const s = new MockVectorStore()
		await s.upsert([row(SYM("a"))])
		expect(await s.countByRun("run_t")).toBe(1)
	})

	it("same nodeId + payloadKind overwrites", async () => {
		const s = new MockVectorStore()
		await s.upsert([row(SYM("a"), "FunctionSummary")])
		await s.upsert([row(SYM("a"), "FunctionSummary")])
		expect(await s.countByRun("run_t")).toBe(1)
	})

	it("same nodeId + different payloadKind coexist", async () => {
		const s = new MockVectorStore()
		await s.upsert([row(SYM("a"), "FunctionSummary")])
		await s.upsert([row(SYM("a"), "Block")])
		expect(await s.countByRun("run_t")).toBe(2)
	})

	it("search returns sorted cosine scores and respects limit", async () => {
		const s = new MockVectorStore()
		const v1 = new Array(EMBEDDING_DIM).fill(0)
		v1[0] = 1
		const v2 = new Array(EMBEDDING_DIM).fill(0)
		v2[1] = 1
		await s.upsert([
			row(SYM("a"), "FunctionSummary", v1),
			row(SYM("b"), "FunctionSummary", v2),
		])
		const q = new Array(EMBEDDING_DIM).fill(0)
		q[0] = 1
		const hits = await s.search({ vector: q, limit: 1 })
		expect(hits.length).toBe(1)
		expect(hits[0]?.nodeId).toBe(SYM("a"))
	})

	it("search filters by repoId", async () => {
		const s = new MockVectorStore()
		const v = new Array(EMBEDDING_DIM).fill(0)
		v[0] = 1
		await s.upsert([
			row(SYM("a"), "FunctionSummary", v),
			row(SYM("b"), "FunctionSummary", v, { repoId: "other" }),
		])
		const hits = await s.search({
			vector: v,
			limit: 10,
			filter: { repoId: "r" },
		})
		expect(hits.map((h) => h.nodeId)).toEqual([SYM("a")])
	})

	it("search filters by indexRunId", async () => {
		const s = new MockVectorStore()
		const v = new Array(EMBEDDING_DIM).fill(0)
		v[0] = 1
		await s.upsert([
			row(SYM("a"), "FunctionSummary", v),
			row(SYM("b"), "FunctionSummary", v, { indexRunId: "run_other" }),
		])
		const hits = await s.search({
			vector: v,
			limit: 10,
			filter: { indexRunId: "run_t" },
		})
		expect(hits.map((h) => h.nodeId)).toEqual([SYM("a")])
	})

	it("search filters by payloadKind", async () => {
		const s = new MockVectorStore()
		const v = new Array(EMBEDDING_DIM).fill(0)
		v[0] = 1
		await s.upsert([
			row(SYM("a"), "FunctionSummary", v),
			row(SYM("a"), "Block", v),
		])
		const hits = await s.search({
			vector: v,
			limit: 10,
			filter: { payloadKind: "Block" },
		})
		expect(hits.length).toBe(1)
		expect(hits[0]?.payloadKind).toBe("Block")
	})

	it("listByRun returns rows for the run only", async () => {
		const s = new MockVectorStore()
		await s.upsert([
			row(SYM("a")),
			row(SYM("b"), "FunctionSummary", new Array(EMBEDDING_DIM).fill(0), {
				indexRunId: "run_other",
			}),
		])
		const rows = await s.listByRun("run_t")
		expect(rows.length).toBe(1)
		expect(rows[0]?.nodeId).toBe(SYM("a"))
	})

	it("listByRun honors limit", async () => {
		const s = new MockVectorStore()
		await s.upsert([
			row(SYM("a")),
			row(SYM("b"), "Block"),
			row(SYM("c"), "Markdown"),
		])
		expect((await s.listByRun("run_t", { limit: 2 })).length).toBe(2)
	})

	it("zero-vector cosine is 0", async () => {
		const s = new MockVectorStore()
		const v = new Array(EMBEDDING_DIM).fill(0)
		await s.upsert([row(SYM("a"), "FunctionSummary", v)])
		const hits = await s.search({ vector: v, limit: 5 })
		expect(hits[0]?.score).toBe(0)
	})

	it("rejects invalid VectorRow via Zod", async () => {
		const s = new MockVectorStore()
		const bad: unknown = row(SYM("a"), "FunctionSummary", [0, 0, 0])
		await expect(s.upsert([bad as VectorRow])).rejects.toThrow()
	})
})
