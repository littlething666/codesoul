import { describe, expect, it } from "vitest"
import { EMBEDDING_DIM, EmbeddingResult } from "@codesoul/core"
import { MockEmbedder } from "../mock.js"

const SYM = "sym_" + "a".repeat(40)
const CNT = "cnt_" + "0".repeat(40)

const makeNodeInput = (text: string) => ({
	kind: "node" as const,
	nodeId: SYM,
	contentHash: CNT,
	payloadKind: "FunctionSummary" as const,
	text,
})

const makeQueryInput = (text: string) => ({
	kind: "query" as const,
	queryId: "q1",
	text,
})

describe("MockEmbedder", () => {
	it("reports modelId, modelRevision, and dimension", () => {
		const e = new MockEmbedder()
		expect(e.modelId).toBe("mock-embedder")
		expect(e.modelRevision).toBe("0")
		expect(e.dimension).toBe(EMBEDDING_DIM)
	})

	it("returns vectors of length EMBEDDING_DIM", async () => {
		const e = new MockEmbedder()
		const [r] = await e.embed([makeNodeInput("hello")])
		expect(r?.vector.length).toBe(EMBEDDING_DIM)
		expect(r?.embeddingDim).toBe(EMBEDDING_DIM)
	})

	it("emits finite values within [-1, 1]", async () => {
		const e = new MockEmbedder()
		const [r] = await e.embed([makeNodeInput("hello")])
		for (const v of r?.vector ?? []) {
			expect(Number.isFinite(v)).toBe(true)
			expect(v).toBeGreaterThanOrEqual(-1)
			expect(v).toBeLessThanOrEqual(1)
		}
	})

	it("is deterministic on identical input", async () => {
		const e = new MockEmbedder()
		const [a] = await e.embed([makeNodeInput("hello")])
		const [b] = await e.embed([makeNodeInput("hello")])
		expect(a?.vector).toEqual(b?.vector)
	})

	it("differs across different inputs", async () => {
		const e = new MockEmbedder()
		const [a] = await e.embed([makeNodeInput("hello")])
		const [b] = await e.embed([makeNodeInput("world")])
		expect(a?.vector).not.toEqual(b?.vector)
	})

	it("sets inputKind=node + nodeId on node embeddings", async () => {
		const e = new MockEmbedder()
		const [r] = await e.embed([makeNodeInput("hello")])
		expect(r?.inputKind).toBe("node")
		expect(r?.nodeId).toBe(SYM)
		expect(r?.queryId).toBeUndefined()
	})

	it("sets inputKind=query + queryId on query embeddings", async () => {
		const e = new MockEmbedder()
		const [r] = await e.embed([makeQueryInput("hello")])
		expect(r?.inputKind).toBe("query")
		expect(r?.queryId).toBe("q1")
		expect(r?.nodeId).toBeUndefined()
	})

	it("validates as EmbeddingResult schema", async () => {
		const e = new MockEmbedder()
		const [r] = await e.embed([makeNodeInput("hello")])
		expect(() => EmbeddingResult.parse(r)).not.toThrow()
	})
})
