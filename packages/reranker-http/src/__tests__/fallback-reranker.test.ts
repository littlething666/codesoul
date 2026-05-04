import { describe, expect, it, vi } from "vitest"
import {
	AdapterUnavailableError,
	type Candidate,
	type RankedCandidate,
} from "@codesoul/core"
import type { Reranker, RerankOptions } from "@codesoul/reranker"
import { FallbackReranker } from "../fallback-reranker.js"

const SYM = (c: string) => `sym_${c.repeat(40)}`

const cand = (nodeId: string, score = 0.5): Candidate => ({
	nodeId,
	source: "semantic",
	score,
	evidencePath: "src/x.ts",
	evidenceLines: [1, 5],
})

class StubReranker implements Reranker {
	calls = 0
	lastOptions: RerankOptions | undefined = undefined
	constructor(
		readonly modelId: string,
		readonly modelRevision: string,
		private readonly impl: (
			query: string,
			candidates: ReadonlyArray<Candidate>,
		) => Promise<RankedCandidate[]>,
	) {}
	async rerank(
		query: string,
		candidates: ReadonlyArray<Candidate>,
		options?: RerankOptions,
	): Promise<RankedCandidate[]> {
		this.calls++
		this.lastOptions = options
		return this.impl(query, candidates)
	}
}

const primaryOk = (modelId = "primary-rr", revision = "v1") =>
	new StubReranker(modelId, revision, async (_q, candidates) =>
		candidates.map((c, i) => ({ ...c, rerankScore: 1 - i * 0.1 })),
	)

const primaryThrowing = (err: unknown) =>
	new StubReranker("primary-rr", "v1", async () => {
		throw err
	})

const fallbackOk = () =>
	new StubReranker("mock-reranker", "0", async (_q, candidates) =>
		candidates.map((c) => ({ ...c, rerankScore: c.score })),
	)

describe("FallbackReranker", () => {
	it("reports the primary's identity", () => {
		const r = new FallbackReranker({
			primary: primaryOk("Qwen/Qwen3-Reranker-0.6B", "abc"),
			fallback: fallbackOk(),
		})
		expect(r.modelId).toBe("Qwen/Qwen3-Reranker-0.6B")
		expect(r.modelRevision).toBe("abc")
	})

	it("returns primary's results when primary succeeds; fallback is never called", async () => {
		const primary = primaryOk()
		const fallback = fallbackOk()
		const r = new FallbackReranker({ primary, fallback })
		const out = await r.rerank("q", [cand(SYM("a"))])
		expect(out).toHaveLength(1)
		expect(primary.calls).toBe(1)
		expect(fallback.calls).toBe(0)
	})

	it("falls back when primary throws AdapterUnavailableError", async () => {
		const err = new AdapterUnavailableError("server down")
		const primary = primaryThrowing(err)
		const fallback = fallbackOk()
		const r = new FallbackReranker({ primary, fallback })
		const out = await r.rerank("q", [cand(SYM("a"))])
		expect(out).toHaveLength(1)
		expect(primary.calls).toBe(1)
		expect(fallback.calls).toBe(1)
	})

	it("calls onFallback exactly once with the original error", async () => {
		const err = new AdapterUnavailableError("server down")
		const primary = primaryThrowing(err)
		const fallback = fallbackOk()
		const onFallback = vi.fn()
		const r = new FallbackReranker({ primary, fallback, onFallback })
		await r.rerank("q", [cand(SYM("a"))])
		expect(onFallback).toHaveBeenCalledTimes(1)
		expect(onFallback).toHaveBeenCalledWith(err)
	})

	it("does NOT fall back on a generic Error; it propagates", async () => {
		const err = new TypeError("programmer bug")
		const primary = primaryThrowing(err)
		const fallback = fallbackOk()
		const r = new FallbackReranker({ primary, fallback })
		await expect(
			r.rerank("q", [cand(SYM("a"))]),
		).rejects.toBe(err)
		expect(fallback.calls).toBe(0)
	})

	it("forwards RerankOptions to the primary", async () => {
		const primary = primaryOk()
		const fallback = fallbackOk()
		const r = new FallbackReranker({ primary, fallback })
		await r.rerank("q", [cand(SYM("a"))], { timeoutMs: 1234 })
		expect(primary.lastOptions).toEqual({ timeoutMs: 1234 })
	})
})
