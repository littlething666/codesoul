import { describe, expect, it, vi } from "vitest"
import {
	AdapterUnavailableError,
	EMBEDDING_DIM,
	EmbeddingCompatibilityError,
	type EmbedInput,
	type EmbeddingResult,
} from "@codesoul/core"
import type { Embedder } from "@codesoul/embedder"
import { FallbackEmbedder } from "../fallback-embedder.js"

const SYM = "sym_" + "a".repeat(40)
const CNT = "cnt_" + "0".repeat(40)

const nodeInput = (text: string): EmbedInput => ({
	kind: "node",
	nodeId: SYM,
	contentHash: CNT,
	payloadKind: "FunctionSummary",
	text,
})

const zeros = (n: number): number[] => new Array(n).fill(0)

const makeResult = (
	modelId: string,
	modelRevision: string,
): EmbeddingResult => ({
	inputKind: "node",
	nodeId: SYM,
	vector: zeros(EMBEDDING_DIM),
	embeddingModel: modelId,
	embeddingRevision: modelRevision,
	embeddingDim: EMBEDDING_DIM,
})

class StubEmbedder implements Embedder {
	calls = 0
	constructor(
		readonly modelId: string,
		readonly modelRevision: string,
		readonly dimension: number,
		private readonly impl: (
			inputs: ReadonlyArray<EmbedInput>,
		) => Promise<EmbeddingResult[]>,
	) {}
	async embed(
		inputs: ReadonlyArray<EmbedInput>,
	): Promise<EmbeddingResult[]> {
		this.calls++
		return this.impl(inputs)
	}
}

const primaryOk = (modelId = "primary", revision = "v1") =>
	new StubEmbedder(modelId, revision, EMBEDDING_DIM, async () => [
		makeResult(modelId, revision),
	])

const primaryThrowing = (err: unknown) =>
	new StubEmbedder("primary", "v1", EMBEDDING_DIM, async () => {
		throw err
	})

const fallbackOk = () =>
	new StubEmbedder(
		"mock-embedder",
		"0",
		EMBEDDING_DIM,
		async () => [makeResult("mock-embedder", "0")],
	)

describe("FallbackEmbedder", () => {
	it("reports the primary's identity for modelId, modelRevision, dimension", () => {
		const e = new FallbackEmbedder({
			primary: primaryOk("Qwen/Qwen3-Embedding-0.6B", "abc"),
			fallback: fallbackOk(),
		})
		expect(e.modelId).toBe("Qwen/Qwen3-Embedding-0.6B")
		expect(e.modelRevision).toBe("abc")
		expect(e.dimension).toBe(EMBEDDING_DIM)
	})

	it("returns primary's results when primary succeeds; fallback is never called", async () => {
		const primary = primaryOk("Qwen/Qwen3-Embedding-0.6B", "abc")
		const fallback = fallbackOk()
		const e = new FallbackEmbedder({ primary, fallback })
		const out = await e.embed([nodeInput("hello")])
		expect(out).toHaveLength(1)
		expect(out[0]?.embeddingModel).toBe("Qwen/Qwen3-Embedding-0.6B")
		expect(primary.calls).toBe(1)
		expect(fallback.calls).toBe(0)
	})

	it("falls back when primary throws AdapterUnavailableError", async () => {
		const err = new AdapterUnavailableError("server down")
		const primary = primaryThrowing(err)
		const fallback = fallbackOk()
		const e = new FallbackEmbedder({ primary, fallback })
		const out = await e.embed([nodeInput("hello")])
		expect(primary.calls).toBe(1)
		expect(fallback.calls).toBe(1)
		// Fallback's identity is preserved on the result so vector store
		// correctness is not silently subverted.
		expect(out[0]?.embeddingModel).toBe("mock-embedder")
	})

	it("calls onFallback exactly once with the original error", async () => {
		const err = new AdapterUnavailableError("server down")
		const primary = primaryThrowing(err)
		const fallback = fallbackOk()
		const onFallback = vi.fn()
		const e = new FallbackEmbedder({ primary, fallback, onFallback })
		await e.embed([nodeInput("hello")])
		expect(onFallback).toHaveBeenCalledTimes(1)
		expect(onFallback).toHaveBeenCalledWith(err)
	})

	it("does NOT fall back on EmbeddingCompatibilityError; it propagates", async () => {
		const err = new EmbeddingCompatibilityError("wrong model")
		const primary = primaryThrowing(err)
		const fallback = fallbackOk()
		const onFallback = vi.fn()
		const e = new FallbackEmbedder({ primary, fallback, onFallback })
		await expect(e.embed([nodeInput("hello")])).rejects.toBe(err)
		expect(fallback.calls).toBe(0)
		expect(onFallback).not.toHaveBeenCalled()
	})

	it("does NOT fall back on a generic Error; it propagates", async () => {
		const err = new TypeError("programmer bug")
		const primary = primaryThrowing(err)
		const fallback = fallbackOk()
		const e = new FallbackEmbedder({ primary, fallback })
		await expect(e.embed([nodeInput("hello")])).rejects.toBe(err)
		expect(fallback.calls).toBe(0)
	})

	it("forwards the input list verbatim to whichever embedder runs", async () => {
		let seen: ReadonlyArray<EmbedInput> | null = null
		const fallback = new StubEmbedder(
			"mock-embedder",
			"0",
			EMBEDDING_DIM,
			async (inputs) => {
				seen = inputs
				return inputs.map(() => makeResult("mock-embedder", "0"))
			},
		)
		const primary = primaryThrowing(
			new AdapterUnavailableError("down"),
		)
		const e = new FallbackEmbedder({ primary, fallback })
		const inputs = [nodeInput("a"), nodeInput("b"), nodeInput("c")]
		await e.embed(inputs)
		expect(seen).toEqual(inputs)
	})
})
