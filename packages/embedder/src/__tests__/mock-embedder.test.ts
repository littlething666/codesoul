import { describe, expect, it } from "vitest"
import { EMBEDDING_DIM, EmbeddingResult } from "@codesoul/core"
import { MockEmbedder } from "../mock.js"

const makeInput = (text: string) => ({
	nodeId: "node_1",
	contentHash: "cnt_0000000000000000000000000000000000000000",
	payloadKind: "FunctionSummary" as const,
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
		const [r] = await e.embed([makeInput("hello")])
		expect(r?.vector.length).toBe(EMBEDDING_DIM)
		expect(r?.embeddingDim).toBe(EMBEDDING_DIM)
	})

	it("emits finite values within [-1, 1]", async () => {
		const e = new MockEmbedder()
		const [r] = await e.embed([makeInput("hello")])
		for (const v of r?.vector ?? []) {
			expect(Number.isFinite(v)).toBe(true)
			expect(v).toBeGreaterThanOrEqual(-1)
			expect(v).toBeLessThanOrEqual(1)
		}
	})

	it("is deterministic on identical input", async () => {
		const e = new MockEmbedder()
		const [a] = await e.embed([makeInput("hello")])
		const [b] = await e.embed([makeInput("hello")])
		expect(a?.vector).toEqual(b?.vector)
	})

	it("differs across different inputs", async () => {
		const e = new MockEmbedder()
		const [a] = await e.embed([makeInput("hello")])
		const [b] = await e.embed([makeInput("world")])
		expect(a?.vector).not.toEqual(b?.vector)
	})

	it("validates as EmbeddingResult schema", async () => {
		const e = new MockEmbedder()
		const [r] = await e.embed([makeInput("hello")])
		expect(() => EmbeddingResult.parse(r)).not.toThrow()
	})
})
