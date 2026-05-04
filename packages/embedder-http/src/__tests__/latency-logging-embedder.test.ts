import { describe, expect, it, vi } from "vitest"
import {
	EMBEDDING_DIM,
	type EmbedInput,
	type EmbeddingResult,
} from "@codesoul/core"
import type { Embedder } from "@codesoul/embedder"
import { LatencyLoggingEmbedder } from "../latency-logging-embedder.js"

const SYM = "sym_" + "a".repeat(40)
const CNT = "cnt_" + "0".repeat(40)

const nodeInput = (text: string): EmbedInput => ({
	kind: "node",
	nodeId: SYM,
	contentHash: CNT,
	payloadKind: "FunctionSummary",
	text,
})

const makeResult = (
	modelId: string,
	revision: string,
): EmbeddingResult => ({
	inputKind: "node",
	nodeId: SYM,
	vector: new Array(EMBEDDING_DIM).fill(0),
	embeddingModel: modelId,
	embeddingRevision: revision,
	embeddingDim: EMBEDDING_DIM,
})

class StubEmbedder implements Embedder {
	calls = 0
	lastInputs: ReadonlyArray<EmbedInput> | null = null
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
		this.lastInputs = inputs
		return this.impl(inputs)
	}
}

describe("LatencyLoggingEmbedder", () => {
	it("forwards modelId, modelRevision, and dimension from the inner embedder", () => {
		const inner = new StubEmbedder("m", "v1", EMBEDDING_DIM, async () => [])
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingEmbedder({ inner, logger })
		expect(wrapped.modelId).toBe("m")
		expect(wrapped.modelRevision).toBe("v1")
		expect(wrapped.dimension).toBe(EMBEDDING_DIM)
	})

	it("returns the inner embedder's result on success", async () => {
		const inner = new StubEmbedder(
			"m",
			"v1",
			EMBEDDING_DIM,
			async () => [makeResult("m", "v1")],
		)
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingEmbedder({ inner, logger })
		const out = await wrapped.embed([nodeInput("hi")])
		expect(out).toHaveLength(1)
		expect(out[0]?.embeddingModel).toBe("m")
	})

	it("emits one info log per successful call with input/result counts and durationMs", async () => {
		let t = 1000
		const now = () => t
		const inner = new StubEmbedder(
			"Qwen/Qwen3-Embedding-0.6B",
			"abc",
			EMBEDDING_DIM,
			async () => {
				t += 25
				return [makeResult("Qwen/Qwen3-Embedding-0.6B", "abc")]
			},
		)
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingEmbedder({ inner, logger, now })
		await wrapped.embed([nodeInput("hi")])
		expect(logger.warn).not.toHaveBeenCalled()
		expect(logger.info).toHaveBeenCalledTimes(1)
		expect(logger.info).toHaveBeenCalledWith(
			{
				adapter: "embedder",
				modelId: "Qwen/Qwen3-Embedding-0.6B",
				modelRevision: "abc",
				inputCount: 1,
				resultCount: 1,
				durationMs: 25,
			},
			"embedder.embed",
		)
	})

	it("emits a warn log and rethrows on failure with durationMs and err message", async () => {
		let t = 2000
		const now = () => t
		const boom = new Error("boom")
		const inner = new StubEmbedder(
			"m",
			"v1",
			EMBEDDING_DIM,
			async () => {
				t += 7
				throw boom
			},
		)
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingEmbedder({ inner, logger, now })
		await expect(wrapped.embed([nodeInput("hi")])).rejects.toBe(boom)
		expect(logger.info).not.toHaveBeenCalled()
		expect(logger.warn).toHaveBeenCalledTimes(1)
		expect(logger.warn).toHaveBeenCalledWith(
			{
				adapter: "embedder",
				modelId: "m",
				modelRevision: "v1",
				inputCount: 1,
				durationMs: 7,
				err: "boom",
			},
			"embedder.embed.failed",
		)
	})

	it("forwards the input list verbatim to the inner embedder", async () => {
		const inner = new StubEmbedder(
			"m",
			"v1",
			EMBEDDING_DIM,
			async (inputs) =>
				inputs.map(() => makeResult("m", "v1")),
		)
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingEmbedder({ inner, logger })
		const inputs = [nodeInput("a"), nodeInput("b"), nodeInput("c")]
		await wrapped.embed(inputs)
		expect(inner.lastInputs).toEqual(inputs)
		expect(logger.info).toHaveBeenCalledWith(
			expect.objectContaining({ inputCount: 3, resultCount: 3 }),
			"embedder.embed",
		)
	})

	it("non-Error throwables surface as String(err) in the warn record", async () => {
		const inner = new StubEmbedder(
			"m",
			"v1",
			EMBEDDING_DIM,
			async () => {
				throw "socket hang up"
			},
		)
		const logger = { info: vi.fn(), warn: vi.fn() }
		const wrapped = new LatencyLoggingEmbedder({ inner, logger })
		await expect(wrapped.embed([nodeInput("x")])).rejects.toBe(
			"socket hang up",
		)
		expect(logger.warn).toHaveBeenCalledWith(
			expect.objectContaining({ err: "socket hang up" }),
			"embedder.embed.failed",
		)
	})
})
