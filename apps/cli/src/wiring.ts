import pino from "pino"
import type { Logger } from "pino"
import {
	FileSystemSourceProvider,
	IndexConfig,
	MockSourceProvider,
	defaultIndexConfig,
	type RigExtractorKind,
	type SourceProvider,
} from "@codesoul/core"
import { AdapterUnavailableError } from "@codesoul/core"
import type { Embedder } from "@codesoul/embedder"
import { MockEmbedder } from "@codesoul/embedder/mock"
import {
	FallbackEmbedder,
	HttpEmbedder,
	LatencyLoggingEmbedder,
} from "@codesoul/embedder-http"
import type { GraphStore } from "@codesoul/graph-store"
import { MockGraphStore } from "@codesoul/graph-store/mock"
import { Neo4jGraphStore } from "@codesoul/graph-store-neo4j"
import type { ManifestStore } from "@codesoul/manifest-store"
import { InMemoryManifestStore } from "@codesoul/manifest-store/memory"
import { SqliteManifestStore } from "@codesoul/manifest-store/sqlite"
import type { Parser } from "@codesoul/parser"
import { MockParser } from "@codesoul/parser/mock"
import { TreeSitterParser } from "@codesoul/parser/tree-sitter"
import type { Reranker } from "@codesoul/reranker"
import { MockReranker } from "@codesoul/reranker/mock"
import {
	FallbackReranker,
	HttpReranker,
	LatencyLoggingReranker,
} from "@codesoul/reranker-http"
import type { RigExtractor } from "@codesoul/rig"
import { RigDispatcher } from "@codesoul/rig/dispatcher"
import { ManualYamlRigExtractor } from "@codesoul/rig/manual-yaml"
import { MockRigExtractor } from "@codesoul/rig/mock"
import { PackageJsonRigExtractor } from "@codesoul/rig/package-json"
import { PyProjectRigExtractor } from "@codesoul/rig/pyproject"
import { SpadeCMakeRigExtractor } from "@codesoul/rig/spade-cmake"
import { MockSummarizer } from "@codesoul/summarizer/mock"
import type { VectorStore } from "@codesoul/vector-store"
import { MockVectorStore } from "@codesoul/vector-store/mock"
import { LanceDBVectorStore } from "@codesoul/vector-store-lancedb"
import { FixtureIndexer } from "@codesoul/indexer"
import type { Indexer } from "@codesoul/indexer"

export type RuntimeDeps = {
	parser: Parser
	rig: RigExtractor
	/**
	 * Graph store retyped to the GraphStore interface (Phase 3 wiring).
	 * Selecting Neo4j at the IndexConfig layer means callers must talk
	 * to the structural interface, not MockGraphStore-only methods.
	 */
	graph: GraphStore
	/**
	 * Vector store retyped to the VectorStore interface (Phase 6 wiring).
	 * Selecting LanceDB at the IndexConfig layer means callers must talk to
	 * the structural interface, not MockVectorStore-only methods.
	 */
	vectors: VectorStore
	embedder: Embedder
	reranker: Reranker
	summarizer: MockSummarizer
	manifestStore: ManifestStore
	indexer: Indexer
	sourceProvider: SourceProvider
	config: IndexConfig
}

// Backwards-compatible alias; migrate to RuntimeDeps.
/** @deprecated Use RuntimeDeps instead. */
export type Phase0Deps = RuntimeDeps

export type WireEnv = Partial<Record<string, string>>

// Backwards-compatible alias; migrate to WireEnv.
/** @deprecated Use WireEnv instead. */
export type WirePhase0Env = WireEnv

export type WireOptions = {
	/**
	 * Optional pino logger. Defaults to a silent pino so tests and dry-run
	 * smokes don't pollute stdout. The fallback wrappers wire `onFallback`
	 * to `logger.warn` so degraded mode is observable in real CLI runs.
	 */
	logger?: Logger
	/**
	 * Environment-variable bag used by the http wiring. Defaults to
	 * `process.env`. Tests inject a stub map so we never read real env.
	 */
	env?: WireEnv
}

// Backwards-compatible alias; migrate to WireOptions.
/** @deprecated Use WireOptions instead. */
export type WirePhase0Options = WireOptions

const buildParser = (mode: IndexConfig["parser"]): Parser => {
	switch (mode) {
		case "tree-sitter":
			return new TreeSitterParser()
		case "regex":
			return new MockParser()
	}
}

const buildRigExtractor = (kind: RigExtractorKind): RigExtractor => {
	switch (kind) {
		case "package-json":
			return new PackageJsonRigExtractor()
		case "pyproject":
			return new PyProjectRigExtractor()
		case "manual":
			return new ManualYamlRigExtractor()
		case "spade":
			return new SpadeCMakeRigExtractor()
	}
}

const buildRig = (config: IndexConfig): RigExtractor => {
	if (config.rigExtractors.length === 0) {
		// Preserve legacy behavior: with no explicit extractors configured,
		// the wiring stays on the deterministic mock so existing tests and
		// dry-run smokes don't depend on filesystem layout.
		return new MockRigExtractor()
	}
	const extractors = config.rigExtractors.map(buildRigExtractor)
	return new RigDispatcher(extractors)
}

const buildSourceProvider = (env: WireEnv): SourceProvider => {
	const repoPath = env.CODESOUL_REPO_PATH
	if (repoPath) return new FileSystemSourceProvider(repoPath)
	return new MockSourceProvider()
}

/**
 * Build the ManifestStore from the provided profile.
 *
 * - "memory" (default): InMemoryManifestStore.
 * - "local-persist": SqliteManifestStore with WAL at
 *   the path given by CODESOUL_MANIFEST_PATH (defaults to
 *   `.codesoul/manifest.db` in the repo root).
 */
const buildManifestStore = (
	mode: IndexConfig["manifestStore"],
	env: WireEnv,
	logger: Logger,
): ManifestStore => {
	switch (mode) {
		case "memory":
			return new InMemoryManifestStore()
		case "sqlite": {
			const repoPath = env.CODESOUL_REPO_PATH
			const dbPath =
				env.CODESOUL_MANIFEST_PATH ??
				(repoPath
					? `${repoPath}/.codesoul/manifest.db`
					: ":memory:")
			logger.info({ dbPath }, "manifest store: sqlite")
			return new SqliteManifestStore(dbPath)
		}
	}
}

/**
 * Phase 3 wiring: pick the GraphStore implementation from IndexConfig.
 *
 * - "memory" returns a fresh MockGraphStore (the default).
 * - "neo4j" requires CODESOUL_NEO4J_URL / _USER / _PASSWORD and
 *   constructs a Neo4jGraphStore with `autoMigrate: true`. The adapter
 *   defers the actual driver session to the first call, and migrations
 *   run idempotently on the first write — so constructing it here does
 *   not hit the network and `wireRuntime` can stay synchronous.
 *
 * There is intentionally no "fall back to mock" knob (mirroring the
 * LanceDB wiring, and unlike the HTTP embedder/reranker). Graph
 * identity is persisted, so silently swapping backends would let later
 * traversals read across incompatible stores.
 */
const buildGraphStore = (
	mode: IndexConfig["graphStore"],
	env: WireEnv,
): GraphStore => {
	switch (mode) {
		case "memory":
			return new MockGraphStore()
		case "neo4j": {
			const uri = env.CODESOUL_NEO4J_URL
			const username = env.CODESOUL_NEO4J_USER
			const password = env.CODESOUL_NEO4J_PASSWORD
			if (!uri || !username || !password) {
				throw new AdapterUnavailableError(
					"graphStore: 'neo4j' requires CODESOUL_NEO4J_URL, CODESOUL_NEO4J_USER, and CODESOUL_NEO4J_PASSWORD",
				)
			}
			const database = env.CODESOUL_NEO4J_DATABASE
			return new Neo4jGraphStore({
				uri,
				username,
				password,
				...(database ? { database } : {}),
				autoMigrate: true,
			})
		}
	}
}

/**
 * Phase 6 wiring: pick the VectorStore implementation from IndexConfig.
 *
 * - "memory" returns a fresh MockVectorStore (the default).
 * - "lancedb" requires CODESOUL_VECTOR_STORE_URI and constructs a
 *   LanceDBVectorStore. The adapter is lazy: it only opens a connection
 *   on the first upsert/search/listByRun call, so constructing it here
 *   does not require the @lancedb/lancedb native binding to be loadable
 *   on every machine that imports this module.
 *
 * There is intentionally no "fall back to mock" knob (unlike the HTTP
 * embedder/reranker). Vector identity is persisted, so silently swapping
 * backends would let later searches read across incompatible tables.
 */
const buildVectorStore = (
	mode: IndexConfig["vectorStore"],
	env: WireEnv,
): VectorStore => {
	switch (mode) {
		case "memory":
			return new MockVectorStore()
		case "lancedb": {
			const uri = env.CODESOUL_VECTOR_STORE_URI
			if (!uri) {
				throw new AdapterUnavailableError(
					"vectorStore: 'lancedb' requires CODESOUL_VECTOR_STORE_URI",
				)
			}
			const tableName = env.CODESOUL_VECTOR_STORE_TABLE
			const manifestPath = env.CODESOUL_VECTOR_STORE_MANIFEST_PATH
			const tokenizerVersion = env.CODESOUL_VECTOR_STORE_TOKENIZER_VERSION
			return new LanceDBVectorStore({
				uri,
				...(tableName ? { tableName } : {}),
				...(manifestPath ? { manifestPath } : {}),
				...(tokenizerVersion ? { tokenizerVersion } : {}),
			})
		}
	}
}

/**
 * Phase 5c residual: opt-in latency logging.
 *
 * Wrapping the FINAL embedder/reranker (after fallback, if any) means
 * the timing record captures the user-visible call duration, including
 * any fallback retry. Wrapping the primary instead would silently drop
 * the fallback's call from the metrics, which defeats the purpose.
 *
 * Default OFF so existing tests that assert on `instanceof HttpEmbedder`
 * stay byte-identical without env-var orchestration. Truthy values
 * accepted: "1", "true", "yes" (case-insensitive).
 */
const isLatencyLoggingEnabled = (env: WireEnv): boolean => {
	const raw = env.CODESOUL_LOG_LATENCY
	if (!raw) return false
	const lower = raw.toLowerCase()
	return lower === "1" || lower === "true" || lower === "yes"
}

const buildEmbedder = (
	mode: IndexConfig["embedder"],
	env: WireEnv,
	logger: Logger,
): Embedder => {
	const mock = new MockEmbedder()
	let final: Embedder
	if (mode === "mock") {
		final = mock
	} else {
		const url = env.CODESOUL_EMBEDDER_URL
		const modelId = env.CODESOUL_EMBEDDER_MODEL
		const modelRevision = env.CODESOUL_EMBEDDER_REVISION
		if (!url || !modelId || !modelRevision) {
			throw new AdapterUnavailableError(
				"embedder: 'http' requires CODESOUL_EMBEDDER_URL, CODESOUL_EMBEDDER_MODEL, and CODESOUL_EMBEDDER_REVISION",
			)
		}
		const headers: Record<string, string> = {}
		if (env.CODESOUL_EMBEDDER_AUTH) {
			headers.authorization = env.CODESOUL_EMBEDDER_AUTH
		}
		const http = new HttpEmbedder({
			url,
			modelId,
			modelRevision,
			...(Object.keys(headers).length > 0 ? { headers } : {}),
		})
		if (env.CODESOUL_EMBEDDER_FALLBACK === "mock") {
			final = new FallbackEmbedder({
				primary: http,
				fallback: mock,
				onFallback: (err) =>
					logger.warn(
						{ err: err.message, modelId, modelRevision },
						"embedder fell back to mock",
					),
			})
		} else {
			final = http
		}
	}
	return isLatencyLoggingEnabled(env)
		? new LatencyLoggingEmbedder({ inner: final, logger })
		: final
}

const buildReranker = (
	mode: IndexConfig["reranker"],
	sourceProvider: SourceProvider,
	env: WireEnv,
	logger: Logger,
): Reranker => {
	const mock = new MockReranker()
	let final: Reranker
	if (mode === "mock") {
		final = mock
	} else {
		const url = env.CODESOUL_RERANKER_URL
		const modelId = env.CODESOUL_RERANKER_MODEL
		const modelRevision = env.CODESOUL_RERANKER_REVISION
		if (!url || !modelId || !modelRevision) {
			throw new AdapterUnavailableError(
				"reranker: 'http' requires CODESOUL_RERANKER_URL, CODESOUL_RERANKER_MODEL, and CODESOUL_RERANKER_REVISION",
			)
		}
		const headers: Record<string, string> = {}
		if (env.CODESOUL_RERANKER_AUTH) {
			headers.authorization = env.CODESOUL_RERANKER_AUTH
		}
		const http = new HttpReranker({
			url,
			modelId,
			modelRevision,
			sourceProvider,
			...(Object.keys(headers).length > 0 ? { headers } : {}),
		})
		if (env.CODESOUL_RERANKER_FALLBACK === "mock") {
			final = new FallbackReranker({
				primary: http,
				fallback: mock,
				onFallback: (err) =>
					logger.warn(
						{ err: err.message, modelId, modelRevision },
						"reranker fell back to mock",
					),
			})
		} else {
			final = http
		}
	}
	return isLatencyLoggingEnabled(env)
		? new LatencyLoggingReranker({ inner: final, logger })
		: final
}

export const wireRuntime = (
	configOverrides: Partial<IndexConfig> = {},
	options: WireOptions = {},
): RuntimeDeps => {
	const env: WireEnv =
		options.env ?? (process.env as WireEnv)
	const logger: Logger =
		options.logger ?? pino({ level: env.CODESOUL_LOG_LEVEL ?? "silent" })
	const config = IndexConfig.parse({
		...defaultIndexConfig(),
		...configOverrides,
	})
	const parser = buildParser(config.parser)
	const rig = buildRig(config)
	const graph = buildGraphStore(config.graphStore, env)
	const vectors = buildVectorStore(config.vectorStore, env)
	const sourceProvider = buildSourceProvider(env)
	const embedder = buildEmbedder(config.embedder, env, logger)
	const reranker = buildReranker(
		config.reranker,
		sourceProvider,
		env,
		logger,
	)
	const summarizer = new MockSummarizer()
	const manifestStore = buildManifestStore(config.manifestStore, env, logger)
	const indexer = new FixtureIndexer({
		parser,
		rig,
		graph,
		vectors,
		embedder,
		manifestStore,
	})
	return {
		parser,
		rig,
		graph,
		vectors,
		embedder,
		reranker,
		summarizer,
		manifestStore,
		indexer,
		sourceProvider,
		config,
	}
}

// Backwards-compatible alias; migrate to wireRuntime.
/** @deprecated Use wireRuntime instead. */
export const wirePhase0 = wireRuntime
