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
	LatencyLoggingEmbedder,
} from "@codesoul/embedder-http"
import { MockGraphStore } from "@codesoul/graph-store/mock"
import { Neo4jGraphStore } from "@codesoul/graph-store-neo4j"
import { MockReranker } from "@codesoul/reranker/mock"
import {
	FallbackReranker,
	HttpReranker,
	LatencyLoggingReranker,
} from "@codesoul/reranker-http"
import { MockVectorStore } from "@codesoul/vector-store/mock"
import { LanceDBVectorStore } from "@codesoul/vector-store-lancedb"
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

describe("wirePhase0 (graph store, Phase 3)", () => {
	it("defaults to MockGraphStore when graphStore mode is 'memory'", () => {
		const deps = wirePhase0({}, { env: {}, logger: silentLogger })
		expect(deps.config.graphStore).toBe("memory")
		expect(deps.graph).toBeInstanceOf(MockGraphStore)
	})

	it("throws AdapterUnavailableError when graphStore='neo4j' but env vars are missing", () => {
		expect(() =>
			wirePhase0(
				{ graphStore: "neo4j" },
				{ env: {}, logger: silentLogger },
			),
		).toThrow(AdapterUnavailableError)
	})

	it("throws AdapterUnavailableError when only some neo4j env vars are set", () => {
		expect(() =>
			wirePhase0(
				{ graphStore: "neo4j" },
				{
					env: {
						CODESOUL_NEO4J_URL: "bolt://localhost:7687",
						CODESOUL_NEO4J_USER: "neo4j",
						// password missing
					},
					logger: silentLogger,
				},
			),
		).toThrow(AdapterUnavailableError)
	})

	it("constructs Neo4jGraphStore when all neo4j env vars are set", () => {
		const deps = wirePhase0(
			{ graphStore: "neo4j" },
			{
				env: {
					CODESOUL_NEO4J_URL: "bolt://localhost:7687",
					CODESOUL_NEO4J_USER: "neo4j",
					CODESOUL_NEO4J_PASSWORD: "password",
				},
				logger: silentLogger,
			},
		)
		// Construction is lazy: the driver session opens only on first call,
		// so this assertion does not require Neo4j to be reachable.
		expect(deps.graph).toBeInstanceOf(Neo4jGraphStore)
		expect(deps.config.graphStore).toBe("neo4j")
	})

	it("forwards optional CODESOUL_NEO4J_DATABASE", () => {
		const deps = wirePhase0(
			{ graphStore: "neo4j" },
			{
				env: {
					CODESOUL_NEO4J_URL: "bolt://localhost:7687",
					CODESOUL_NEO4J_USER: "neo4j",
					CODESOUL_NEO4J_PASSWORD: "password",
					CODESOUL_NEO4J_DATABASE: "custom",
				},
				logger: silentLogger,
			},
		)
		expect(deps.graph).toBeInstanceOf(Neo4jGraphStore)
	})
})

describe("wirePhase0 (vector store, Phase 6)", () => {
	it("defaults to MockVectorStore when vectorStore mode is 'memory'", () => {
		const deps = wirePhase0({}, { env: {}, logger: silentLogger })
		expect(deps.config.vectorStore).toBe("memory")
		expect(deps.vectors).toBeInstanceOf(MockVectorStore)
	})

	it("throws AdapterUnavailableError when vectorStore='lancedb' but CODESOUL_VECTOR_STORE_URI is missing", () => {
		expect(() =>
			wirePhase0(
				{ vectorStore: "lancedb" },
				{ env: {}, logger: silentLogger },
			),
		).toThrow(AdapterUnavailableError)
	})

	it("constructs LanceDBVectorStore when CODESOUL_VECTOR_STORE_URI is set", () => {
		const deps = wirePhase0(
			{ vectorStore: "lancedb" },
			{
				env: { CODESOUL_VECTOR_STORE_URI: "/tmp/codesoul-vectors" },
				logger: silentLogger,
			},
		)
		// Construction is lazy: the underlying lancedb connection is not
		// opened until the first upsert/search/listByRun, so this assertion
		// does not require the @lancedb/lancedb native binding.
		expect(deps.vectors).toBeInstanceOf(LanceDBVectorStore)
		expect(deps.config.vectorStore).toBe("lancedb")
	})

	it("forwards optional CODESOUL_VECTOR_STORE_TABLE / MANIFEST_PATH / TOKENIZER_VERSION", () => {
		const deps = wirePhase0(
			{ vectorStore: "lancedb" },
			{
				env: {
					CODESOUL_VECTOR_STORE_URI: "/tmp/codesoul-vectors",
					CODESOUL_VECTOR_STORE_TABLE: "custom_vectors",
					CODESOUL_VECTOR_STORE_MANIFEST_PATH:
						"/tmp/codesoul-manifest.json",
					CODESOUL_VECTOR_STORE_TOKENIZER_VERSION: "qwen3-tok-1",
				},
				logger: silentLogger,
			},
		)
		expect(deps.vectors).toBeInstanceOf(LanceDBVectorStore)
	})
})

describe("wirePhase0 (latency logging, Phase 5c)", () => {
	it("does NOT wrap the embedder when CODESOUL_LOG_LATENCY is unset", () => {
		const deps = wirePhase0({}, { env: {}, logger: silentLogger })
		expect(deps.embedder).not.toBeInstanceOf(LatencyLoggingEmbedder)
		expect(deps.embedder).toBeInstanceOf(MockEmbedder)
	})

	it("does NOT wrap the reranker when CODESOUL_LOG_LATENCY is unset", () => {
		const deps = wirePhase0({}, { env: {}, logger: silentLogger })
		expect(deps.reranker).not.toBeInstanceOf(LatencyLoggingReranker)
		expect(deps.reranker).toBeInstanceOf(MockReranker)
	})

	it("wraps the mock embedder/reranker when CODESOUL_LOG_LATENCY=1", () => {
		const deps = wirePhase0(
			{},
			{
				env: { CODESOUL_LOG_LATENCY: "1" },
				logger: silentLogger,
			},
		)
		expect(deps.embedder).toBeInstanceOf(LatencyLoggingEmbedder)
		expect(deps.reranker).toBeInstanceOf(LatencyLoggingReranker)
	})

	it("accepts 'true' and 'yes' (case-insensitive) as truthy values", () => {
		for (const value of ["true", "TRUE", "yes", "Yes"]) {
			const deps = wirePhase0(
				{},
				{
					env: { CODESOUL_LOG_LATENCY: value },
					logger: silentLogger,
				},
			)
			expect(deps.embedder).toBeInstanceOf(LatencyLoggingEmbedder)
		}
	})

	it("ignores unrecognized values like '0', 'false', or empty string", () => {
		for (const value of ["0", "false", "no", ""]) {
			const deps = wirePhase0(
				{},
				{
					env: { CODESOUL_LOG_LATENCY: value },
					logger: silentLogger,
				},
			)
			expect(deps.embedder).not.toBeInstanceOf(LatencyLoggingEmbedder)
		}
	})

	it("wraps the http embedder (after FallbackEmbedder) when CODESOUL_LOG_LATENCY=1 and embedder=http", () => {
		const deps = wirePhase0(
			{ embedder: "http" },
			{
				env: {
					CODESOUL_EMBEDDER_URL: URL_E,
					CODESOUL_EMBEDDER_MODEL: MODEL_E,
					CODESOUL_EMBEDDER_REVISION: REV_E,
					CODESOUL_EMBEDDER_FALLBACK: "mock",
					CODESOUL_LOG_LATENCY: "1",
				},
				logger: silentLogger,
			},
		)
		expect(deps.embedder).toBeInstanceOf(LatencyLoggingEmbedder)
		// Identity still surfaces all the way out from the http primary,
		// even through both the FallbackEmbedder and LatencyLoggingEmbedder layers.
		expect(deps.embedder.modelId).toBe(MODEL_E)
		expect(deps.embedder.modelRevision).toBe(REV_E)
	})

	it("wraps the http reranker when CODESOUL_LOG_LATENCY=1 and reranker=http", () => {
		const deps = wirePhase0(
			{ reranker: "http" },
			{
				env: {
					CODESOUL_RERANKER_URL: URL_R,
					CODESOUL_RERANKER_MODEL: MODEL_R,
					CODESOUL_RERANKER_REVISION: REV_R,
					CODESOUL_LOG_LATENCY: "1",
				},
				logger: silentLogger,
			},
		)
		expect(deps.reranker).toBeInstanceOf(LatencyLoggingReranker)
		expect(deps.reranker.modelId).toBe(MODEL_R)
		expect(deps.reranker.modelRevision).toBe(REV_R)
	})
})
