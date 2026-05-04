import { describe, expect, it, vi } from "vitest"
import type {
	Candidate,
	RankedCandidate,
} from "@codesoul/core"
import type { Reranker, RerankOptions } from "@codesoul/reranker"
import { LatencyLoggingReranker } from "../latency-logging-reranker.js"

const SYM = "sym_" + "a".repeat(40)

const cand = (nodeId: string, score = 0.5): Candidate => ({
	nodeId,
	source: "semantic",
	score,
	evidencePath: "src/x.ts",
	evidenceLines: [1, 5],
})

class StubReranker implements Reranker {
	calls = 0
	lastQuery: string | null = null
	lastCandidates: ReadonlyArray<Candidate> | null = null
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
		this.lastQuery = query
		this.lastCandidates = candidates
		this.lastOptions = options
		return this.impl(query, candidates)
	}
}

describe("LatencyLoggingReranker", () => {
	it("forwards modelId and modelRevision from the inner reranker", () => {
		const inner = new StubReranker(
			"Qwen/Qwen3-Reranker-0.6B",
			"abc",
			async (_q, cs) => cs.map((c) => ({ ...c, rerankScore: c.score })),
		)
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingReranker({ inner, logger })
		expect(wrapped.modelId).toBe("Qwen/Qwen3-Reranker-0.6B")
		expect(wrapped.modelRevision).toBe("abc")
	})

	it("returns the inner reranker's result on success", async () => {
		const inner = new StubReranker("r", "v1", async (_q, cs) =>
			cs.map((c, i) => ({ ...c, rerankScore: 1 - i * 0.1 })),
		)
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingReranker({ inner, logger })
		const out = await wrapped.rerank("q", [cand(SYM)])
		expect(out).toHaveLength(1)
		expect(out[0]?.rerankScore).toBe(1)
	})

	it("emits one info log per successful call with candidateCount and durationMs", async () => {
		let t = 5000
		const now = () => t
		const inner = new StubReranker("r", "v1", async (_q, cs) => {
			t += 13
			return cs.map((c) => ({ ...c, rerankScore: c.score }))
		})
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingReranker({ inner, logger, now })
		await wrapped.rerank("q", [cand(SYM), cand(SYM, 0.3)])
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.info).toHaveBeenCalledTimes(1)
		expect(logger.info).toHaveBeenCalledWith(
			{
				adapter: "reranker",
				modelId: "r",
				modelRevision: "v1",
				candidateCount: 2,
				durationMs: 13,
			},
			"reranker.rerank",
		)
	})

	it("emits a warn log and rethrows on failure", async () => {
		let t = 0
		const now = () => t
		const boom = new Error("reranker offline")
		const inner = new StubReranker("r", "v1", async () => {
			t += 41
			throw boom
		})
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingReranker({ inner, logger, now })
		await expect(wrapped.rerank("q", [cand(SYM)])).rejects.toBe(boom)
		expect(logger.info).not.toHaveBeenCalled()
		expect(logger.warn).toHaveBeenCalledTimes(1)
		expect(logger.warn).toHaveBeenCalledWith(
			{
				adapter: "reranker",
				modelId: "r",
				modelRevision: "v1",
				candidateCount: 1,
				durationMs: 41,
				err: "reranker offline",
			},
			"reranker.rerank.failed",
		)
	})

	it("forwards RerankOptions verbatim to the inner reranker", async () => {
		const inner = new StubReranker("r", "v1", async (_q, cs) =>
			cs.map((c) => ({ ...c, rerankScore: c.score })),
		)
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingReranker({ inner, logger })
		await wrapped.rerank("q", [cand(SYM)], { timeoutMs: 1234 })
		expect(inner.lastOptions).toEqual({ timeoutMs: 1234 })
	})

	it("forwards the candidate list verbatim to the inner reranker", async () => {
		const inner = new StubReranker("r", "v1", async (_q, cs) =>
			cs.map((c) => ({ ...c, rerankScore: c.score })),
		)
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingReranker({ inner, logger })
		const candidates = [cand(SYM), cand(SYM, 0.4), cand(SYM, 0.1)]
		await wrapped.rerank("q", candidates)
		expect(inner.lastCandidates).toEqual(candidates)
	})
})
