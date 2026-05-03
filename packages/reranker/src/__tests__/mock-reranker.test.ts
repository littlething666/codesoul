import { describe, expect, it } from "vitest"
import type { Candidate } from "@codesoul/core"
import { MockReranker } from "../mock.js"

const cand = (id: string, score: number): Candidate => ({
	nodeId: id,
	source: "exact",
	score,
	evidencePath: "src/x.ts",
	evidenceLines: [1, 1],
})

describe("MockReranker", () => {
	it("preserves order and copies score to rerankScore", async () => {
		const r = new MockReranker()
		const out = await r.rerank("q", [cand("a", 1), cand("b", 0.5)])
		expect(out.map((c) => c.nodeId)).toEqual(["a", "b"])
		expect(out[0]?.rerankScore).toBe(1)
		expect(out[1]?.rerankScore).toBe(0.5)
	})

	it("does not mutate input", async () => {
		const r = new MockReranker()
		const input: Candidate[] = [cand("a", 1)]
		await r.rerank("q", input)
		expect("rerankScore" in (input[0] ?? {})).toBe(false)
	})

	it("supports empty candidates", async () => {
		const r = new MockReranker()
		expect(await r.rerank("q", [])).toEqual([])
	})
})
