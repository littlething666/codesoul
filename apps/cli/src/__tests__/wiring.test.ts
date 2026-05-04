import { describe, expect, it, vi } from "vitest"
import {
	AdapterUnavailableError,
	FileSystemSourceProvider,
	MockSourceProvider,
} from "@codesoul/core"
import { MockEmbedder } from "@codesoul/embedder/mock"
import {
	FallbackEmbedder,
	HttpEmbedder,
} from "@codesoul/embedder-http"
import { MockReranker } from "@codesoul/reranker/mock"
import {
	FallbackReranker,
	HttpReranker,
} from "@codesoul/reranker-http"
import { wirePhase0 } from "../wiring.js"

const MODEL_E = "Qwen/Qwen3-Embedding-0.6B"
const REV_E = "emb-rev"
const MODEL_R = "Qwen/Qwen3-Reranker-0.6B"
const REV_R = "rr-rev"
const URL_E = "http://embedder.test/embed"
const URL_R = "http://reranker.test/rerank"

const silentLogger = {
	warn: vi.fn(),
	info: vi.fn(),
	error: vi.fn(),
	debug: vi.fn(),
	trace: vi.fn(),
	fatal: vi.fn(),
	child: () => silentLogger,
} as unknown as Parameters<typeof wirePhase0>[1] extends infer T
	? T extends { logger?: infer L }
		? L
		: never
	: never

describe("wirePhase0 (http modes)", () => {
	it("defaults to MockEmbedder when embedder mode is 'mock'", () => {
		const deps = wirePhase0({}, { env: {}, logger: silentLogger })
		expect(deps.embedder).toBeInstanceOf(MockEmbedder)
	})

	it("defaults to MockReranker when reranker mode is 'mock'", () => {
		const deps = wirePhase0({}, { env: {}, logger: silentLogger })
		expect(deps.reranker).toBeInstanceOf(MockReranker)
	})

	it("throws AdapterUnavailableError when embedder='http' but env vars are missing", () => {
		expect(() =>
			wirePhase0(
				{ embedder: "http" },
				{ env: {}, logger: silentLogger },
			),
		).toThrow(AdapterUnavailableError)
	})

	it("throws AdapterUnavailableError when only some embedder env vars are set", () => {
		expect(() =>
			wirePhase0(
				{ embedder: "http" },
				{
					env: { CODESOUL_EMBEDDER_URL: URL_E },
					logger: silentLogger,
				},
			),
		).toThrow(AdapterUnavailableError)
	})

	it("constructs HttpEmbedder when all embedder env vars are set", () => {
		const deps = wirePhase0(
			{ embedder: "http" },
			{
				env: {
					CODESOUL_EMBEDDER_URL: URL_E,
					CODESOUL_EMBEDDER_MODEL: MODEL_E,
					CODESOUL_EMBEDDER_REVISION: REV_E,
				},
				logger: silentLogger,
			},
		)
		expect(deps.embedder).toBeInstanceOf(HttpEmbedder)
		expect(deps.embedder.modelId).toBe(MODEL_E)
		expect(deps.embedder.modelRevision).toBe(REV_E)
	})

	it("wraps HttpEmbedder in FallbackEmbedder when CODESOUL_EMBEDDER_FALLBACK=mock", () => {
		const deps = wirePhase0(
			{ embedder: "http" },
			{
				env: {
					CODESOUL_EMBEDDER_URL: URL_E,
					CODESOUL_EMBEDDER_MODEL: MODEL_E,
					CODESOUL_EMBEDDER_REVISION: REV_E,
					CODESOUL_EMBEDDER_FALLBACK: "mock",
				},
				logger: silentLogger,
			},
		)
		expect(deps.embedder).toBeInstanceOf(FallbackEmbedder)
		// Identity reflects the http primary, not the mock fallback.
		expect(deps.embedder.modelId).toBe(MODEL_E)
	})

	it("throws AdapterUnavailableError when reranker='http' but env vars are missing", () => {
		expect(() =>
			wirePhase0(
				{ reranker: "http" },
				{ env: {}, logger: silentLogger },
			),
		).toThrow(AdapterUnavailableError)
	})

	it("constructs HttpReranker when all reranker env vars are set", () => {
		const deps = wirePhase0(
			{ reranker: "http" },
			{
				env: {
					CODESOUL_RERANKER_URL: URL_R,
					CODESOUL_RERANKER_MODEL: MODEL_R,
					CODESOUL_RERANKER_REVISION: REV_R,
				},
				logger: silentLogger,
			},
		)
		expect(deps.reranker).toBeInstanceOf(HttpReranker)
		expect(deps.reranker.modelId).toBe(MODEL_R)
		expect(deps.reranker.modelRevision).toBe(REV_R)
	})

	it("wraps HttpReranker in FallbackReranker when CODESOUL_RERANKER_FALLBACK=mock", () => {
		const deps = wirePhase0(
			{ reranker: "http" },
			{
				env: {
					CODESOUL_RERANKER_URL: URL_R,
					CODESOUL_RERANKER_MODEL: MODEL_R,
					CODESOUL_RERANKER_REVISION: REV_R,
					CODESOUL_RERANKER_FALLBACK: "mock",
				},
				logger: silentLogger,
			},
		)
		expect(deps.reranker).toBeInstanceOf(FallbackReranker)
		expect(deps.reranker.modelId).toBe(MODEL_R)
	})

	it("defaults sourceProvider to MockSourceProvider when CODESOUL_REPO_PATH is unset", () => {
		const deps = wirePhase0({}, { env: {}, logger: silentLogger })
		expect(deps.sourceProvider).toBeInstanceOf(MockSourceProvider)
	})

	it("builds FileSystemSourceProvider when CODESOUL_REPO_PATH is set", () => {
		const deps = wirePhase0(
			{},
			{
				env: { CODESOUL_REPO_PATH: "/tmp/some-repo" },
				logger: silentLogger,
			},
		)
		expect(deps.sourceProvider).toBeInstanceOf(FileSystemSourceProvider)
	})

	it("reads from process.env when no env override is provided", () => {
		// Sanity check that the default path doesn't crash; we don't set any
		// CODESOUL_* vars in test env, so this stays on the mock branch.
		const deps = wirePhase0({})
		expect(deps.embedder).toBeInstanceOf(MockEmbedder)
		expect(deps.reranker).toBeInstanceOf(MockReranker)
	})
})
