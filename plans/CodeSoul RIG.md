<aside>
📝

**Status:** Plan updated 2026-05-03 to reflect decisions from architecture review and to pin exact runtime, package, image, and model revisions. This document is the source of truth for v1 scope, schema, pipeline, and dependency baselines.

</aside>

## ✅ Implementation status

<aside>
🚧

**Last updated:** 2026-05-04 (post PR #15 merge, with refreshed `pnpm-lock.yaml`). Tracking what has actually shipped against the v1 plan below. Each "PR #N" is a pull request on `littlething666/codesoul` (open or merged as noted).

</aside>

### Landed

- **Phase 0 — scaffold** (branch `phase-0-tdd`)
    - pnpm workspaces + Turborepo + tsup + vitest layout
    - `@codesoul/core` DTOs (Zod): `PersistedMeta`, `GraphNode`/`GraphEdge`, `VectorRow`, `BatchManifest`, `IngestionManifest`, `RigGraph`, `EmbedInput`, `EmbeddingResult`, retrieval types
    - `stableId` / `contentId` / `edgeContentHash` (sha1, line numbers excluded from IDs)
    - `MockParser`, `MockRigExtractor`, `MockGraphStore`, `MockVectorStore`, `MockEmbedder`, `MockReranker`, `MockSummarizer`
    - `FixtureIndexer` end-to-end smoke test against `fixtures/tiny-ts-lib`
    - CLI skeleton (`index`, `query`, `inspect`, `graph export`)
- **Phase 0.5 — interface hardening** ([PR #2](https://github.com/littlething666/codesoul/pull/2))
    - `EmbedInput` → discriminated union (`kind: "node" | "query"`); `EmbeddingResult` carries `inputKind` plus optional `nodeId` / `queryId`
    - `GraphStore.listNodes` / `listEdges` with `kind` / `pathPrefix` / `repoId` / `indexRunId` / `limit` / `type` filters; Cypher stays off the interface
    - `VectorStore.search` filter (`repoId`, `indexRunId`, `payloadKind`); `VectorStore.listByRun`
    - `IndexConfig` DTO; `TokenEstimator` + `ByteTokenEstimator`; `SourceProvider` + `MockSourceProvider`; `EmbeddingCompatibilityError`
    - `sourceContentHash` fixed: hashes `(relativePath, sha1(contents))` tuples sorted by path instead of the absolute repo path
    - `Phase0Deps` includes `summarizer` and `config: IndexConfig`; `inspect nodes` / `edges` / `vectors` backed by the new list APIs
- **Phase 1 — SQLite manifest/WAL** ([PR #3](https://github.com/littlething666/codesoul/pull/3))
    - New package `@codesoul/manifest-store` with `./memory` and `./sqlite` subpath exports
    - Three tables: `batch_manifest`, `batch_event`, `ingestion_manifest`; indexes on `index_run_id`, `repo_id`, `status`, `batch_id`
    - WAL journal mode + foreign keys; transactional `recordBatch` / `transitionBatch` / `finishIngestion`; idempotent upsert for `recordIngestion`
    - Status transitions fail closed (`pending → committed | failed | dry_run`; everything else terminal); throws `ManifestStateError`
    - Shared contract test runs against both `InMemoryManifestStore` and `SqliteManifestStore` (`:memory:` for the latter)
    - Pinned `better-sqlite3@12.9.0`, `@types/better-sqlite3@7.6.13`
- **Phase 2 — wire `ManifestStore` into `FixtureIndexer`** ([PR #4](https://github.com/littlething666/codesoul/pull/4), merged)
    - `FixtureIndexerDeps` now accepts an injected `ManifestStore`; the legacy inline `transitionStatus` collapsed into `recordBatch` / `transitionBatch` calls on the store
    - Default wiring uses `InMemoryManifestStore`; the SQLite store is available via the `@codesoul/manifest-store/sqlite` subpath when callers want WAL persistence
    - `dryRun` runs land as `status: "dry_run"`; success runs transition `pending → committed` with `committedAt` stamped by the store
- **Phase 2A — tree-sitter parser (decls only)** ([PR #5](https://github.com/littlething666/codesoul/pull/5), merged)
    - New `@codesoul/parser/tree-sitter` subpath export with `TreeSitterParser` (TypeScript / JavaScript via the TS grammar / Python)
    - Emits `File` / `Class` / `Function` / `Method` nodes with full body line ranges; methods qualified as `path::ClassName.methodName`
    - `CONTAINS` edges from File → every decl; reuses the `stableId` / `contentId` / `edgeContentHash` conventions verbatim from `MockParser`
    - Native bindings loaded via `createRequire(import.meta.url)` so the module works under `"type": "module"`; the three native modules added to root `pnpm.onlyBuiltDependencies`
    - `IndexConfig.parser` switch wired through `wirePhase0(overrides)` and surfaced as `codesoul index --parser <regex|tree-sitter>` with Zod-backed validation; JSON output now includes the parser mode actually used
    - `MockParser` retained as the `regex` baseline; existing assertions that `MockParser` does NOT emit methods continue to pass unchanged
    - **Pin deviation from §Parser stack:** shipped with `tree-sitter@0.22.4`, `tree-sitter-typescript@0.23.2`, `tree-sitter-python@0.23.6` (not the plan's `0.25.0` line) — the 0.25.x runtime is not yet ABI-compatible with available `tree-sitter-typescript` / `tree-sitter-python` builds. Plan pins to be revisited when 0.25-compatible grammars publish.
- **Phase 2B + 2C — Imports + intra-file CALLS in `TreeSitterParser`** ([PR #6](https://github.com/littlething666/codesoul/pull/6), merged)
    - Phase 2B: `Import` nodes (TS `import_statement` / `export … from`, Python `import_statement` / `import_from_statement`); per-file dedup by stable id; `File → Import` `CONTAINS` and `IMPORTS` edges
    - Phase 2B: TS/JS local relative imports additionally emit a deterministic `File → File` `IMPORTS` edge using `stableId(...)` for the resolved target; `.js`/`.jsx`/`.mjs`/`.cjs` map to `.ts`/`.tsx`/`.mts`/`.cts` (ESM-TS convention); bare specifiers, extensionless / directory imports, and root-escaping paths are skipped; Python imports stay node-only
    - Phase 2C: naive intra-file `CALLS` edges with `bare` (top-level Function) and `thisOrSelf` (Method on caller's own class) resolution; cross-class same-named methods stay isolated; self-recursion skipped; multiple call sites between the same caller/callee dedup to one edge
    - All new edges carry `edgeContentHash({ src, type, dst })` and validate against `GraphEdge`; `MockParser`, `build-batch.test.ts`, and `smoke.test.ts` are unchanged
- **Phase 3 — `FileSystemSourceProvider` + retrieval snippet text** ([PR #7](https://github.com/littlething666/codesoul/pull/7))
    - `@codesoul/core` adds `FileSystemSourceProvider` alongside `MockSourceProvider`: 1-indexed inclusive line slicing rooted at a configurable `repoRoot`; absolute paths bypass the root; CRLF normalization; OOB start/end clamp; `start > end` and missing-file reads fall back to `""` so a stale graph reference never crashes retrieval
    - `@codesoul/retrieval` `retrieve()` accepts an optional `sourceProvider` on `RetrievalDeps` and populates every `ContextBundle.snippets[].text`; the default stays `MockSourceProvider` so existing pipeline assertions and mock-only specs keep passing without edits
    - CLI `query` gains `--repo <path>`: when set, wiring swaps in `FileSystemSourceProvider(opts.repo)` so `pnpm --filter @codesoul/cli exec node dist/bin.js query greet --repo ./fixtures/tiny-ts-lib` returns real source slices
    - `Phase0Deps` carries `sourceProvider` (defaulted to mock); test coverage adds a recording-provider contract test plus an end-to-end FS test that writes a temp file and asserts the snippet `text` matches the file's first three lines verbatim
- **Phase 3 — Neo4j graph store adapter + docker-compose** ([PR #8](https://github.com/littlething666/codesoul/pull/8), merged)
    - New `@codesoul/graph-store-neo4j` package implementing the `GraphStore` interface against Neo4j 5.26 LTS via `neo4j-driver@6.0.1` (`disableLosslessIntegers: true`); Cypher stays internal and never leaks across the interface
    - `NEO4J_MIGRATIONS`: 6 idempotent statements — uniqueness on `(:Symbol { id })`, BTREE indexes on `repoId` / `kind` / `path` / `qualifiedName`, and an edge index on `(src, type, dst)`; no APOC required
    - Single `:Symbol` label with `kind` stored as a property (avoids label proliferation); `attributes` round-trip through a `__attrJson` string property; `neighbors()` runs layer-complete BFS so depth-bounded traversal returns the whole frontier ring
    - `docker-compose.yml` pinned to `neo4j:5.26-community` with healthcheck, named volume, and `NEO4J_AUTH=neo4j/password` (no `latest` tag)
    - Unit tests for migrations + cypher-mapping plus an integration suite (`integration.test.ts`) gated on `NEO4J_INTEGRATION_URL`, covering upsert idempotency, traversal, `edgeType` filters, qualified-name lookup, list filters, and health
    - Local runner `scripts/test-neo4j-integration.sh` (boots Neo4j via compose, runs Vitest, tears down; `KEEP_NEO4J=1` to keep it up) plus opt-in CI workflow `.github/workflows/integration-neo4j.yml` (PR-scoped to `packages/graph-store-neo4j/**` + `workflow_dispatch`) using GitHub Actions `services: neo4j`
- **Phase 7a + 7b + 7c — RIG extractor primitives + dispatcher** ([PR #9](https://github.com/littlething666/codesoul/pull/9), merged)
    - New `@codesoul/rig` subpath exports: `./package-json`, `./pyproject`, `./manual-yaml`, `./dispatcher` (alongside existing `./mock`)
    - `PackageJsonRigExtractor` (Phase 7a): walks `package.json` + `pnpm-workspace.yaml` workspace patterns; emits `RigComponent` (`kind: "package" | "workspace"`) per workspace package; resilient to missing/malformed files and invalid workspace globs (silent skip with hardened `expandPatterns`)
    - `PyProjectRigExtractor` (Phase 7b): parses `pyproject.toml` via `smol-toml@1.6.1`; emits `RigComponent` (`kind: "package"`) for the project plus `RigTarget` entries for `[project.scripts]` / `[project.gui-scripts]` entry points
    - `ManualYamlRigExtractor` (Phase 7c): reads `codesoul.rig.yaml` via `yaml@2.8.3`, validates every component / target / test against the canonical Zod schemas from `@codesoul/core`; missing files, malformed YAML, and invalid `kind` values surface as `canExtract: false` + empty graph (matches existing extractor convention; SPADE fail-closed policy is separate)
    - `RigDispatcher` (Phase 7e foundation) + exported `mergeRigGraphs(...)` helper: composes multiple `RigExtractor`s, runs `extract()` only on children whose `canExtract` is true, dedupes components / targets / tests by `id` (first writer wins on identity fields), unions `dependsOn` arrays for same-id components across extractors, and sorts everything by `id` for byte-stable output. The dispatcher itself implements `RigExtractor`, so dispatchers compose
    - Pinned new deps: `smol-toml@1.6.1`, `yaml@2.8.3`, `zod@4.4.2` (matches §Pinned versions)
    - **Pin deviation from §Parser stack note carried over:** tree-sitter pins remain at `0.22.4` / `0.23.2` / `0.23.6` (PR #5 deviation, unchanged here)
- **Phase 7d + 7e — SpadeCMakeRigExtractor + RigDispatcher wiring + RigGraph materialization** ([PR #10](https://github.com/littlething666/codesoul/pull/10), merged)
    - Phase 7e: `wirePhase0` constructs a `RigExtractor` from `IndexConfig.rigExtractors` (empty list keeps the legacy `MockRigExtractor` default; non-empty builds a `RigDispatcher` over the configured extractors); `Phase0Deps.rig` retyped from the concrete `MockRigExtractor` to the `RigExtractor` interface
    - Phase 7e: new `--rig-extractors <list>` CLI flag on `codesoul index` — comma-separated, per-item validated via `RigExtractorKind.safeParse`; the action re-wires when either `--parser` or `--rig-extractors` differs from the injected config; `index` JSON output now includes the active `rigExtractors` list alongside the active `parser`
    - Phase 7e: new `@codesoul/indexer` `materializeRigGraph(rig, meta) -> { nodes, edges }` (pure, filesystem-free, deterministic). `RigComponent` / `RigTarget` / `RigTest` land as `GraphNode`s with `kind: "RigComponent" | "RigTarget" | "RigTest"` and `language: "unknown"`; `dependsOn` becomes `DEPENDS_ON` edges (dangling deps silently dropped because external npm/PyPI deps are intentionally scoped out by the extractors); targets / tests get `DECLARED_BY` edges to the owning component; empty paths normalized to `"."`
    - Phase 7e: `FixtureIndexer.indexRepository` calls `rig.extract` once and folds the materialized nodes / edges into the same batch as the parser output, so `BatchManifest.nodeCount` / `edgeCount` include RIG contributions and the WAL stays the single source of truth for what was persisted
    - Phase 7d: new `@codesoul/rig/spade-cmake` subpath export with `SpadeCMakeRigExtractor`. `canExtract` gates on `CMakeLists.txt` at the repo root; `extract` spawns the SPADE binary (configurable, default `spade`) with a configurable arg list and timeout (default 60s, hard SIGKILL on expiry); stdout JSON validated against a versioned Zod schema (`SpadeRigOutputV1` with a `version: 1` literal discriminator + the canonical `RigComponent` / `RigTarget` / `RigTest` schemas from `@codesoul/core`); output collections sorted by `id` for byte stability
    - Phase 7d: **fail-closed** per the planning doc's guardrail. Subprocess error, non-zero exit, malformed JSON, missing `version`, future `version: 2`, schema violation (unknown component kind, invalid target kind, malformed id), and timeout each throw `RigExtractionError` rather than silently emitting a partial graph
    - Phase 7d: subprocess seam (`SpadeRunner` injection) so the test suite never depends on a real SPADE binary on PATH. Default runner uses `node:child_process.spawn`. Swapping to `execa@9.6.1` (already pinned in §Core TypeScript library dependencies) is a one-line follow-up gated on a `pnpm-lock.yaml` refresh
    - Phase 7d wiring: `wirePhase0`'s `"spade"` case now constructs a real `SpadeCMakeRigExtractor`, so `wirePhase0({ rigExtractors: ["spade"] })` returns a `RigDispatcher` rather than the legacy mock fallback
- **Phase 5a–5f — HTTP embedder/reranker stack + Python model server + CLI wiring** ([PR #11](https://github.com/littlething666/codesoul/pull/11), merged)
    - Phase 5a: new `@codesoul/embedder-http` package with `HttpEmbedder` over `undici@8.1.0`. Request DTO `{ modelId, modelRevision, dimension, inputs: [{ kind: "node"|"query", … }] }`, response DTO `{ modelId, modelRevision, dimension, embeddings: [{ vector }] }`, both Zod-validated; identity mismatch (modelId / modelRevision / dimension) or per-vector length mismatch throws `EmbeddingCompatibilityError`; network failure / non-2xx / malformed JSON / Zod failure / count mismatch / timeout throws `AdapterUnavailableError`; 17 contract tests against an in-process `node:http` server
    - Phase 5b: new `@codesoul/reranker-http` package with `HttpReranker`. Wire contract `{ modelId, modelRevision, query, candidates: [{ nodeId, text }] }` → `{ modelId, modelRevision, scores: [{ score }] }`; reranker resolves snippet text per candidate via injected `SourceProvider`; identity mismatch surfaces as `AdapterUnavailableError` (rerank scores aren't persisted, so cross-run reranker identity is enforced separately via `IngestionManifest.rerankerModel` / `rerankerRevision`); 14 contract tests
    - Phase 5c: `FallbackEmbedder` (in `@codesoul/embedder-http`) and `FallbackReranker` (in `@codesoul/reranker-http`) wrap a primary + fallback adapter pair; catch **only** `AdapterUnavailableError` so `EmbeddingCompatibilityError` and generic errors propagate untouched; identity getters (`modelId` / `modelRevision` / `dimension`) report the primary's, while the actual `EmbeddingResult` carries the fallback's identity tags when the fallback fires; optional `onFallback(err)` hook fires once per fallback
    - Phase 5d: `wirePhase0` honors `IndexConfig.embedder: "mock" | "http"` and `IndexConfig.reranker: "mock" | "http"`. Env-var-driven HTTP wiring: `CODESOUL_EMBEDDER_URL` / `_MODEL` / `_REVISION` / `_AUTH` / `_FALLBACK=mock`; same shape for `CODESOUL_RERANKER_*`; `CODESOUL_REPO_PATH` builds a `FileSystemSourceProvider` for the reranker. New `WirePhase0Options = { logger?, env? }` second arg; optional `pino@10.3.1` logger defaults to `level: "silent"`. `Phase0Deps.embedder` / `.reranker` retyped from concrete mocks to the `Embedder` / `Reranker` interfaces. `apps/cli/package.json` gained workspace deps on `@codesoul/embedder-http` and `@codesoul/reranker-http`
    - Phase 5e: new Python model server skeleton at `workers/model-server/` (outside the pnpm workspace). FastAPI `0.136.1` + Pydantic `2.13.3` + pydantic-settings `2.14.0`; endpoints `POST /embed`, `POST /rerank`, `GET /health`; `StubEmbedder` produces SHA-256 pseudo-vectors that mirror the JS `MockEmbedder` byte-for-byte; `StubReranker` returns Jaccard similarity over whitespace tokens; server always echoes its own identity, client validates. Real backends (`sentence-transformers==5.4.1`, `transformers==5.7.0`, `torch==2.11.0`, `vllm==0.20.1`) gated behind `[project.optional-dependencies] models` extra. Settings via `CODESOUL_MODEL_SERVER_*` env vars; `TestClient` contract tests cover wire round-trip, determinism, identity echo, and Pydantic rejection of unknown `kind` and extra fields
    - Phase 5f: `--embedder mock|http` and `--reranker mock|http` CLI flags on both `codesoul index` and `codesoul query`, validated via the `EmbedderMode` / `RerankerMode` Zod enums in `@codesoul/core`; the action re-wires when any of `--parser`, `--rig-extractors`, `--embedder`, or `--reranker` differs from the injected config (parity for both commands); `query` gained the same re-wire pattern (previously consumed `deps` directly). Root `README.md` documents end-to-end HTTP setup, the env-var matrix, and the `workers/model-server/` location
- **Phase 5c residual — latency-logging wrappers** ([PR #12](https://github.com/littlething666/codesoul/pull/12), merged)
    - New `LatencyLoggingEmbedder` (`@codesoul/embedder-http`) and `LatencyLoggingReranker` (`@codesoul/reranker-http`): transparent wrappers around any inner `Embedder` / `Reranker`. Emit one pino-shaped `info` record per successful `embed` / `rerank` call (`{ adapter, modelId, modelRevision, inputCount|candidateCount, resultCount, durationMs }`, msg `"embedder.embed"` / `"reranker.rerank"`) and one `warn` + rethrow on failure (`{ ..., err }`, msg `"embedder.embed.failed"` / `"reranker.rerank.failed"`). Identity getters (`modelId` / `modelRevision` / `dimension`) forward to the inner adapter; `RerankOptions` are forwarded verbatim
    - Structural `LatencyLogger` type (`{ info(obj, msg?); warn(obj, msg?) }`) keeps the http packages free of any pino runtime dep — pino's `Logger` satisfies the structural shape via overload resolution. Injectable `now` clock seam makes `durationMs` deterministic in tests
    - Opt-in via `CODESOUL_LOG_LATENCY=1|true|yes` (case-insensitive) in `wirePhase0`. Default off so existing `instanceof HttpEmbedder` / `instanceof HttpReranker` assertions stay green and mock-only flows pay no overhead
    - Wraps the **outermost** adapter (after any `FallbackEmbedder` / `FallbackReranker`), so logged `durationMs` reflects total user-visible latency including fallback retries
    - Test coverage: 6 unit cases per package (identity passthrough, success/failure log shape, input/candidate forwarding, deterministic `durationMs` via injected clock, non-Error throwables stringified) plus 7 new wirePhase0 cases (default unset, `=1` wraps mock, case-insensitive truthy values, falsy values ignored, http-mode interaction with FallbackEmbedder/Reranker layering, reranker http variant). No new runtime deps, no lockfile churn
- **Phase 6 — LanceDB vector store adapter + `wirePhase0` wiring** ([PR #13](https://github.com/littlething666/codesoul/pull/13), merged)
    - New `@codesoul/vector-store-lancedb` package implementing the `VectorStore` interface against `@lancedb/lancedb@0.27.2`. Lazy dynamic import of the native binding — `wirePhase0({ vectorStore: "lancedb" })` does not load the binding until the first `upsert` / `search` / `listByRun`, so unit tests, memory-mode flows, and CI environments without the prebuilt binary pay zero LanceDB cost
    - Persistent table manifest at `<uri>/codesoul-manifest.json` carrying `embeddingModel` / `embeddingRevision` / `embeddingDim` / `tokenizerVersion` / `schemaVersion` (matches the §Storage manifest contract). `upsert` writes the manifest on the first batch and refuses to widen identity on subsequent batches; `search` and `listByRun` validate query identity against the persisted manifest and throw `EmbeddingCompatibilityError` on mismatch. `VectorSearchFilter` (`repoId` / `indexRunId` / `payloadKind`) compiled into LanceDB SQL with `'` → `''` escaping; default table name `vectors`; default `tokenizerVersion` `"unknown"`
    - Internal row schema widens `vector` to `number[] | ArrayLike<number> | Iterable<number>` and a `toPlainVector` helper coerces LanceDB's `Vector` proxy to a plain array before Zod validation in `fromInternal` — fixes the `listByRun` ZodError seen in the in-process LanceDB integration suite. Distance → score conversion `score = 1 / (1 + _distance)` (1.0 = perfect match)
    - Integration suite gated behind `LANCEDB_INTEGRATION=1` (13 cases: identity persistence, manifest write/read/refusal, search filters, `listByRun` / `countByRun`, health). Added `@lancedb/lancedb` to root `pnpm.onlyBuiltDependencies` and refreshed `pnpm-lock.yaml`
    - `wirePhase0` now branches on `IndexConfig.vectorStore: "memory" | "lancedb"` and dispatches through a new `buildVectorStore(mode, env)`. `"memory"` returns `MockVectorStore` (default, behavior unchanged); `"lancedb"` requires `CODESOUL_VECTOR_STORE_URI` and accepts optional `CODESOUL_VECTOR_STORE_TABLE` / `_MANIFEST_PATH` / `_TOKENIZER_VERSION`. **Fail-closed:** missing URI throws `AdapterUnavailableError` rather than silently dropping to memory — vectors are persisted, so a silent backend swap could let later searches read across incompatible tables. No `_FALLBACK=mock` knob, unlike the HTTP embedder/reranker. `Phase0Deps.vectors` retyped from concrete `MockVectorStore` to the `VectorStore` interface
    - New `--vector-store memory|lancedb` CLI flag on both `codesoul index` and `codesoul query`, validated via the `VectorStoreMode` Zod enum from `@codesoul/core`; both commands re-wire when any of `--parser`, `--rig-extractors`, `--embedder`, `--reranker`, or `--vector-store` differs from the injected config. `index` JSON output now reports the active `vectorStore` alongside the other adapter modes. `apps/cli` gained a workspace dep on `@codesoul/vector-store-lancedb`
- **Phase 3 wiring + Phase 5 real backends + cross-language conformance** ([PR #14](https://github.com/littlething666/codesoul/pull/14), merged)
    - Phase 3 wiring: `wirePhase0` honors `IndexConfig.graphStore: "memory" | "neo4j"` via a new `buildGraphStore(mode, env)`. `"memory"` returns `MockGraphStore` (default); `"neo4j"` requires `CODESOUL_NEO4J_URL` / `_USER` / `_PASSWORD` (`_DATABASE` optional, defaults `neo4j`) and constructs a `Neo4jGraphStore` with `autoMigrate: true`. **Fail-closed:** missing env throws `AdapterUnavailableError` with no `_FALLBACK=memory` knob — graph identity is persisted, so a silent backend swap could let later traversals read across incompatible stores. `Phase0Deps.graph` retyped from concrete `MockGraphStore` to the structural `GraphStore` interface
    - `Neo4jGraphStore` gained an `autoMigrate?: boolean` option (default true) and a cached `ensureMigrated()` promise; the first `upsertNodes` / `upsertEdges` call applies `NEO4J_MIGRATIONS` idempotently, so a brand-new database needs no out-of-band bootstrap. `runMigrations()` remains exposed for operators who prefer to migrate explicitly; the second invocation is a no-op because every statement uses `IF NOT EXISTS`
    - New `--graph-store memory|neo4j` CLI flag on both `codesoul index` and `codesoul query`, validated via the `GraphStoreMode` Zod enum from `@codesoul/core`; both commands re-wire when any of `--parser`, `--rig-extractors`, `--embedder`, `--reranker`, `--vector-store`, or `--graph-store` differs from the injected config. `index` JSON output now reports the active `graphStore` alongside the other adapter modes. `apps/cli` gained a workspace dep on `@codesoul/graph-store-neo4j`
    - Phase 5 real backends (Python model server `[models]` extra): `SentenceTransformersEmbedder` for `Qwen/Qwen3-Embedding-0.6B` (1024-dim) and `SentenceTransformersReranker` for `Qwen/Qwen3-Reranker-0.6B` via the `sentence-transformers` `CrossEncoder` API. Lazy imports inside `__init__` keep the bare module surface free of `torch`; constructor enforces a concrete HF revision SHA (`"0"` and empty string rejected before any model load) and the embedder cross-checks `get_sentence_embedding_dimension()` against the configured dimension. `encode(..., normalize_embeddings=True)` for cosine-friendly vectors. New `embedder_device` / `reranker_device` settings forward optional torch device hints. Real-load smoke tests gated on `CODESOUL_MODELS_SMOKE=1` + `CODESOUL_QWEN3_EMBEDDING_REVISION` so the multi-GB download is never accidental. The `vllm` reranker backend is deferred — Qwen3-Reranker-0.6B supports the `CrossEncoder` interface, which is the v1 path
    - Cross-language conformance suite at `packages/embedder-http/src/__tests__/conformance.test.ts`: spawns `python -m codesoul_model_server` on a free 127.0.0.1 port, polls `/health`, then runs the same `EmbedInput[]` (ASCII, empty string, Cyrillic, emoji) through `HttpEmbedder` and `MockEmbedder` and asserts vectors are **bit-identical** via `Buffer.compare` over `Float64Array` raw bytes. JS `Number` and Python `float` are both IEEE 754 binary64 with the same default rounding mode, so the SHA-256-driven stub algorithm forces bit-exact output. Auto-skips when `python3 -c "import codesoul_model_server"` fails so default `pnpm test` runs are not gated on a Python venv; `CODESOUL_PYTHON_BIN` overrides the interpreter for venv runs. Server lifetime bounded with `SIGTERM` → `SIGKILL` escalation in `afterAll`, and stderr is forwarded to the runner for spawn-failure debuggability
    - `pnpm-lock.yaml` refreshed to pick up the new `apps/cli` ↔ `@codesoul/graph-store-neo4j` workspace edge
- **Phase 5 follow-ups + Phase 7d execa swap + nightly determinism + query goldens + medium fixture** ([PR #15](https://github.com/littlething666/codesoul/pull/15), merged)
    - Cross-language conformance for the **reranker** (sibling of PR #14's embedder suite): new `packages/reranker-http/src/__tests__/conformance.test.ts` spawns `python -m codesoul_model_server` (stub backends) on a free 127.0.0.1 port and asserts `HttpReranker` returns scores **bit-identical** to a JS-side reference implementation of the Python `StubReranker.rerank` algorithm (lowercased whitespace tokens → Jaccard, compared via `Buffer.compare` over `Float64Array` byte buffers). Cases: full overlap, partial overlap with mixed case, no overlap, empty / all-whitespace candidate, empty candidate list (asserts no `/rerank` request fires). Skip-gated on `python -c "import codesoul_model_server"` so default `pnpm test` runs aren't gated on a venv. `workers/model-server/README.md` gained a *Cross-language conformance tests* section covering both the embedder and reranker suites and the shared `CODESOUL_PYTHON_BIN` setup. **Note:** the JS `MockReranker` is still a `score → rerankScore` pass-through — converging it onto the Jaccard algorithm requires threading a `SourceProvider` through the `Reranker` interface and is intentionally a separate follow-up; the inline JS Jaccard reference in the test file is enough to catch wire-contract drift today
    - Phase 7d follow-up: `SpadeRunner` default swapped from `node:child_process.spawn` to `execa@9.6.1` (already pinned in §Core TypeScript library dependencies). Behavior preserved end-to-end across the swap: timeout still throws `spade subprocess timed out after Nms`; spawn errors (ENOENT etc.) still throw the underlying `Error` (unwrapped from `result.cause`); non-zero exits still resolve with `{ stdout, stderr, exitCode }` and let `SpadeCMakeRigExtractor.extract()` raise `RigExtractionError`. The `SpadeRunner` seam is unchanged so existing `packages/rig/src/__tests__/spade-cmake.test.ts` cases (which all inject a fake runner) keep passing without modification
    - Index-rebuild determinism nightly check (first beachhead for §CI matrix nightly determinism): new `.github/workflows/nightly.yml` runs daily at 06:17 UTC and on `workflow_dispatch`. Builds the workspace, then runs `scripts/check-index-determinism.sh`, which indexes each fixture twice via the CLI (once with `--parser regex`, once with `--parser tree-sitter`), strips the per-run `batchId` from each JSON output, and asserts the remaining fields (`status`, `parser`, `rigExtractors`, `embedder`, `reranker`, `vectorStore`, `graphStore`, `nodes`, `edges`, `vectors`) match byte-for-byte. Catches obvious non-determinism in the parser + indexer + RIG dispatch path (count drift, ordering changes, set-vs-array regressions). Does **not** yet diff the materialized graph or vector content — `codesoul graph export` is still a stub returning `{ format, nodes: [], edges: [] }`; widening the diff is a follow-up gated on a real graph export
    - Larger acceptance fixture beachhead: new `fixtures/medium-ts-lib/` with ~700 LoC across 7 files — `Cache`, `Queue`, `format` / `parse` utility modules, shared `types.ts` (with a `Result<T, E>` discriminated union), an `index.ts` barrel, a `bin.ts` CLI entrypoint, and a populated `package.json` with `bin` / `scripts` / `dependencies` so the `package-json` RIG extractor has something non-trivial to chew on. Internal cross-module imports, generic class methods, and type-only imports exercise parser features that `tiny-ts-lib`'s 3-file placeholder doesn't reach. **Not** at the §Fixtures `medium-ts-repo` 100K–300K token target — that needs a generator script and is a separate effort — but the new fixture is immediately wired into the determinism workflow above (4-cell matrix: `{tiny-ts-lib, medium-ts-lib} × {regex, tree-sitter}`)
    - Query golden tests at the CLI boundary (first beachhead for §CI matrix query goldens): new `apps/cli/src/__tests__/query-golden.test.ts` locks in the public JSON shape `codesoul query` prints to stdout — top-level keys are exactly `{ citations, query, snippets, tokenBudget }`, `tokenBudget` keys are exactly `{ total, used }`, snippets / citations remain real arrays even when empty. Why CLI-boundary instead of retrieval-boundary: `packages/retrieval/src/__tests__/pipeline.test.ts` already covers the computation; the golden value here is the `ContextBundle` JSON that downstream consumers (humans, scripts, the future MCP server) actually parse. With default mock wiring the pipeline produces zero candidates, so snippets / citations are `[]` and `used` is `0`; the structural contract still gets enforced. A non-empty pre-seeded path (real ranked node IDs for "what calls X?" / "where is X defined?" / "what depends on X?") is a follow-up once the wiring grows a `seed:` knob
    - `pnpm-lock.yaml` refreshed to pick up `execa@9.6.1` as a `@codesoul/rig` runtime dep

### In flight / next

Read [CodeSoul RIG Next Steps](CodeSoul RIG Next Steps.md) for the next steps.

## 🎯 Product framing

**CodeSoul** is a repository **architecture extraction layer**, not a vector retrieval toy. Every v1 decision must defend that framing:

- v1 must prove **graph traversal + architecture localization**, not just semantic snippet search.
- Embedding quality, reranking, and macro summaries are accelerants — they are not the product.
- Inspectability and explainability are first-class. If a result cannot be traced to a node and an edge, it is not a CodeSoul result.

## 🧱 Repository structure

```
codesoul/
  apps/
    cli/                    # TypeScript CLI (index, query, inspect)
    mcp-server/             # TypeScript MCP server (M3, not M1)

  packages/
    core/                   # Domain model, schema, config, IDs, manifests
    parser/                 # Tree-sitter parsing (TS, JS, Python in v1)
    graph-store/            # Neo4j adapter behind GraphStore interface
    vector-store/            # LanceDB adapter behind VectorStore interface
    rig/                    # RIG contract + extractors
    retrieval/              # Hybrid retrieval, ranking, context assembly
    embedder/               # Embedder interface + HTTP backends
    reranker/               # Reranker interface + HTTP backends
    summarizer/             # Summarizer interface (used in v1.1+)

  workers/
    model-server/           # Python (TEI / vLLM / sentence-transformers)
    graph-algos/            # Python (Leiden / k-core), added later

  fixtures/
    tiny-ts-lib/            # ~5K LOC
    tiny-python-lib/        # ~5K LOC
    polyglot-small/         # ~15K LOC
    medium-ts-repo/         # 100K–300K tokens
    large-repo-snapshot/    # 500K–2M tokens (nightly only)
```

**Workspace rules:**

- No package may import from `apps/*`.
- All shared code lives under `packages/*`.
- Workers communicate over typed HTTP contracts only — no shared runtime imports.
- Tooling: pnpm workspaces + Turborepo + tsup + vitest.

## 📦 v1 scope

### MVP smoke vs v1 acceptance

| Tier | Repo size target | Purpose |
| --- | --- | --- |
| MVP smoke | ≤500K tokens | Fast local dev loop, PR CI |
| v1 acceptance | 500K–2M tokens | Stated product target; nightly CI |

**v1 acceptance criterion:** A 2M-token repo indexes successfully on a single machine. Latency does not need to be optimal yet, but the schema, batching, and storage choices must hold.

### Languages

- **v1:** TypeScript, JavaScript, Python, plus metadata files (`package.json`, `tsconfig*.json`, `pyproject.toml`, `setup.py`/`setup.cfg`), and Markdown docs (read-only, embedded for retrieval).
- **Deferred:** Go, Rust, Java, C/C++, C#, Kotlin, Scala.

### Thin vertical slice (must include)

```
repo → AST graph → graph persistence → embeddings → hybrid retrieval → CLI query
```

Plus at least one **graph-aware architecture query** class:

- `what calls X?`
- `where is X defined?`
- `what files/functions are connected to this module?`
- `what depends on this function/class?`

### Must not be deferred (even in MVP)

- Deterministic graph schema
- Graph traversal API
- Stable node identity (dual-ID, see §Schema)
- RIG adapter interface + at least the package.json and pyproject extractors
- Basic build/dependency metadata extraction
- Inspection CLI (`codesoul inspect …`)

### Deferred to v1.1+

- Leiden / k-core community detection
- Macro-node summaries (async, post-index)
- LangGraph or any agent framework
- Temporal / Zep-style memory
- Web UI (replaced by `codesoul inspect` and `codesoul graph export`)

## 🏗️ Architecture & language split

```
TypeScript → CLI, orchestration, schema, graph IO, query API, retrieval
Python / model server → embeddings, reranking, optional graph algorithms
```

Embedding and reranking sit behind **HTTP interfaces from day one** so local, CI, and production share the same contract.

### Inspection surface (v1, replaces web UI)

```
codesoul inspect nodes [--kind Function] [--path src/**]
codesoul inspect edges [--type CALLS]
codesoul inspect vectors [--limit N]
codesoul inspect query "..."
codesoul graph export --format graphml|json
```

## 🧩 Schema & identity

### Dual identifier model

```
stable_id  = sha1(repo_id + relative_path + symbol_kind + qualified_name)
content_id = sha1(normalized_signature + normalized_body)
```

- `stable_id` survives signature changes — used as primary node key.
- `content_id` detects real code changes — drives re-embedding decisions.
- Line numbers live in `evidence` only and never participate in IDs.

### Node model (persisted)

```json
{
  "id": "sym_...",
  "content_hash": "cnt_...",
  "repo_id": "repo_...",
  "path": "src/foo.ts",
  "kind": "Function",
  "language": "typescript",
  "qualified_name": "FooService.createUser",
  "signature": "createUser(input: CreateUserInput): Promise<User>",
  "evidence": { "start_line": 42, "end_line": 88 },
  "index_run_id": "run_...",
  "batch_id": "batch_...",
  "schema_version": 1
}
```

- **No `depends_on_ids` on persisted nodes.** Edges in the graph store are the single source of truth for dependencies.
- **Extractor DTOs and RIG import contracts may include dependency arrays**, but the importer converts them into edges before persistence. Duplicated arrays must never be stored as node properties.

### Node kinds (v1)

`File`, `Module`, `Class`, `Function`, `Method`, `Import`, `RigComponent`, `RigTarget`, `RigTest`, `Block` (gated, see below).

### Block extraction (gated, not deferred)

```
if function_tokens <= 512:
    index Function only
else:
    index Function + Block chunks
```

**v1 block types (TypeScript / JavaScript / Python only):**

- `if`
- `for`
- `while`
- `try`/`catch`
- `switch`/`match`
- nested function
- large statement group (heuristic chunker)

### Edge types (v1)

`CONTAINS`, `CALLS`, `IMPORTS`, `IMPLEMENTS`, `EXTENDS`, `DEFINED_IN`, `DEPENDS_ON` (RIG), `DECLARED_BY` (RIG).

## 🔌 RIG layer

RIG is a **normalized architectural layer**, not a synonym for SPADE.

### Extractor contract

```tsx
interface RigExtractor {
  name: string
  canExtract(repoPath: string): Promise<boolean>
  extract(repoPath: string): Promise<RigGraph>
}
```

### v1 extractors (in priority order)

1. `PackageJsonRigExtractor` — `package.json`, `tsconfig.json`, workspace refs.
2. `PyProjectRigExtractor` — `pyproject.toml`, `setup.py` entry points.
3. `ManualYamlRigExtractor` — `codesoul.rig.yaml` fallback.
4. `SpadeCMakeRigExtractor` — SPADE subprocess for CMake projects.

### SPADE subprocess hardening

- SPADE must emit **versioned JSON**.
- Importer validates with Zod (TS side); the Python worker mirrors with Pydantic.
- Invalid RIG output **fails closed**, never silently ignored.

## 🗄️ Storage

### Graph store: Neo4j 5 (v1)

Neo4j is the v1 default for ecosystem maturity, Cypher familiarity, and Neo4j Browser inspectability. Storage is isolated behind:

```tsx
interface GraphStore {
  upsertNodes(nodes: GraphNode[]): Promise<void>
  upsertEdges(edges: GraphEdge[]): Promise<void>
  getNode(id: string): Promise<GraphNode | null>
  neighbors(id: string, options: TraversalOptions): Promise<GraphNode[]>
  query(cypher: string, params: object): Promise<QueryResult>
}
```

Kuzu can be added later as an embedded backend once the schema stabilizes.

**v1 packaging:**

- `docker-compose.yml` with Neo4j 5
- APOC optional, never required
- `seed`, `test`, `healthcheck` commands in the CLI

### Vector store: LanceDB

- Native **Qwen3-Embedding-0.6B 1024-dim** vectors. No truncation.
- Index manifest must persist `embedding_model`, `embedding_dim`, `tokenizer_version`, `schema_version`. This prevents silent incompatibility on model changes.

### Cross-store consistency (no fake atomicity)

There is no real cross-store transaction between Neo4j and LanceDB. We use an **ingestion manifest + WAL**:

```
1. Parse file
2. Emit deterministic nodes/edges/vector payloads
3. Write batch manifest: status = pending
4. Upsert graph nodes (idempotent by stable_id)
5. Upsert graph edges (idempotent by (src, type, dst))
6. Upsert vectors (idempotent by stable_id)
7. Validate counts/checksums
8. Mark manifest: status = committed
```

On failure: `status = failed`, roll back by `batch_id` if possible, otherwise re-run idempotently.

**Every node, edge, and vector row carries:** `repo_id`, `index_run_id`, `batch_id`, `source_path`, `content_hash`, `schema_version`.

## 🧠 Embedding & reranking

### Interfaces (no hardcoded runtimes)

```tsx
interface Embedder {
  modelId: string
  dimension: number
  embed(input: EmbedInput[]): Promise<EmbeddingResult[]>
}

interface Reranker {
  modelId: string
  rerank(query: string, candidates: Candidate[], opts?: RerankOpts): Promise<RankedCandidate[]>
}
```

### v1 backends

- OpenAI-compatible HTTP embeddings endpoint
- Hugging Face TEI endpoint
- Local Python `sentence-transformers` worker (default for self-hosted)
- Mock embedder/reranker for tests

`transformers.js`, Ollama, and `llama.cpp` may exist as adapters but are **not** architectural defaults.

### Function embedding payload

For each function, embed:

```
FunctionSummaryPayload:
  language
  qualified_name
  signature
  docstring / leading comment
  imports/types referenced
  first 128 body tokens
  last 128 body tokens
```

Long functions additionally get **block embeddings** for chunked body sections (see Schema §Block extraction).

### Reranker policy

```
hybrid candidates: max 60
rerank input:      max 60
final snippets:    max 10
timeout:           configurable, default 2s
fallback:          hybrid score if reranker times out
```

Log per-stage latency: semantic retrieval, graph expansion, rerank, context assembly.

## 🌐 Communities & macro nodes (v1.1+)

Macro summarization is **not on the blocking index path** in v1.

### Two-layer hierarchy

| Layer | Target size | Purpose |
| --- | --- | --- |
| Local code cluster | 10–30 nodes | Snippet-level grouping |
| Architecture community | 30–120 nodes | Module-level abstraction |

```
Depth 0: raw nodes
Depth 1: communities
Depth 2: super-communities (cap)
```

### Clustering fallback triggers

Fall back from Leiden to k-core when **any** of:

- Cluster count is unstable across seeds
- Largest cluster > 40% of graph
- Singleton ratio > 35%
- Average conductance is poor

Do not use modularity `< 0.3` alone as a trigger — code graphs are heterogeneous and directed.

### Summarizer interface

```tsx
interface Summarizer {
  summarizeCommunity(input: CommunitySummaryInput): Promise<CommunitySummary>
}
```

Backends: OpenAI, Anthropic, local model, or `disabled`. No specific provider hardcoded.

## 🔍 Retrieval pipeline

### Default order (lexical-first for code identifiers)

```
1. ParseQuery — extract identifiers, file paths, package names, class names, function names
2. ExactLookup — graph lookup by exact symbol/path
3. If exact hits exist, expand graph from those hits
4. In parallel, run semantic vector search
5. MergeCandidates
6. Rerank
7. AssembleContext
```

### Candidate limits

```
exact symbol hits:    max 20
semantic hits:        max 30
graph-expanded hits:  max 30
rerank input:         max 60
final snippets:       max 10
```

Macro-node inclusion is **conditional**: if summaries are unavailable or stale, retrieval must not block.

### Context budget (8K tokens default)

```
1.0K  system / query / retrieval explanation
1.0K  architecture summaries (when available)
5.5K  code snippets
0.5K  citations / evidence
```

**Hard rule:** every snippet must include file path and line range.

## 🤖 Orchestration

No LangGraph in v1. Explicit, boring state machines.

### Index state machine

```
IndexRepo
  → DiscoverFiles
  → ParseFiles
  → ExtractRig
  → BuildGraph
  → EmbedNodes
  → PersistGraph
  → PersistVectors
  → ValidateIndex
  → Ready
```

### Query state machine

```
ParseQuery
  → ExactLookup
  → VectorSearch
  → GraphExpand
  → MergeCandidates
  → Rerank
  → AssembleContext
  → Return
```

No temporal / Zep-style memory in v1.

## ✅ Evaluation

### v1 north-star metrics

| Metric | Target |
| --- | --- |
| Symbol localization Recall@10 | ≥ 85% |
| File localization Recall@10 | ≥ 90% |
| Architecture QA accuracy | ≥ 70% |
| Retrieval latency p95 (local) | ≤ 2s |
| Index success on 500K-token repo | 100% |
| Index success on 2M-token repo | ≥ 1 successful fixture |

**Secondary (do not gate v1):** HumanEval / MBPP pass@1 lift, GraphRAG-Bench multi-hop accuracy, RepoCraft tasks.

### Fixtures

```
fixtures/tiny-ts-lib          ~5K LOC
fixtures/tiny-python-lib      ~5K LOC
fixtures/polyglot-small       ~15K LOC
fixtures/medium-ts-repo       100K–300K tokens
fixtures/large-repo-snapshot  500K–2M tokens (nightly only)
```

### CI split

- **PR CI:** tiny + small + polyglot fixtures.
- **Nightly CI:** medium + large fixtures, latency benchmark, reranker benchmark, index rebuild determinism.

## 🚀 Milestones

```
M1  CLI index           (parse → graph → vectors → manifest, on TS+JS+Python)
M2  CLI query           (lexical-first hybrid + rerank + inspect commands)
M3  MCP server          (exposes query, neighbors, traversal)
M4  Editor integrations
M5  Macro summaries     (async, post-index, v1.1)
M6  Leiden / k-core     (graph-algos worker)
```

MCP is **not** in M1. It only ships once the CLI query path is stable.

## 🧪 CI matrix

```
Node 22, 24 (Node 24 primary)
Ubuntu, macOS
Unit tests
Fixture ingestion smoke test
Graph snapshot check ±5%
Vector row count check
Query golden tests
Schema migration tests
Docker-compose healthcheck (Neo4j 5)
Python model-server contract tests
```

Nightly:

```
Large repo ingestion (500K–2M tokens)
Latency benchmark
Reranker benchmark
Index rebuild determinism check
```

## 📌 Pinned versions & dependency policy

All runtimes, packages, Docker images, and model revisions in v1 must use **exact pins**. Avoid `latest` Docker/image tags except during scheduled dependency-refresh windows (Renovate/Dependabot weekly PRs, gated by fixture ingestion, query golden tests, model-server contract tests, and the index rebuild determinism check).

### Runtime baseline

| Layer | Pinned version | Notes |
| --- | --- | --- |
| Node.js (primary) | `24.x LTS` | Canonical local/CI runtime ("Krypton") |
| Node.js (compatibility) | `22.x LTS` | Retain matrix coverage |
| Node.js (avoid) | `20.x` | EOL — dropped from CI matrix |
| Python (model server) | `3.13.13` | Safer ML compatibility, default for v1 |
| Python (test only) | `3.14.4` | Latest stable; evaluate later, not default |

CI matrix moves from `node: [20, 22]` to `node: [22, 24]` on Ubuntu and macOS. Node 24 is the canonical local/runtime target; Node 22 is compatibility coverage.

### TypeScript monorepo (root tooling)

| Package | Pin | Use |
| --- | --- | --- |
| `pnpm` | `10.33.2` | Package manager |
| `turbo` | `2.9.6` | Task graph |
| `typescript` | `6.0.3` | TS compiler |
| `tsup` | `8.5.1` | Package builds |
| `vitest` | `4.1.5` | Tests |
| `eslint` | `10.3.0` | Lint |
| `prettier` | `3.8.3` | Formatting |
| `tsx` | `4.21.0` | Scripts |
| `@types/node` | `24.12.2` | Node 24 types |

Root `package.json`:

```json
{
  "packageManager": "pnpm@10.33.2",
  "engines": {
    "node": ">=22 <25",
    "pnpm": "10.33.2"
  },
  "devDependencies": {
    "@types/node": "24.12.2",
    "eslint": "10.3.0",
    "prettier": "3.8.3",
    "tsup": "8.5.1",
    "tsx": "4.21.0",
    "turbo": "2.9.6",
    "typescript": "6.0.3",
    "vitest": "4.1.5"
  }
}
```

### Core TypeScript library dependencies

| Package | Pin | Use |
| --- | --- | --- |
| `zod` | `4.4.2` | DTO/schema validation |
| `commander` | `14.0.3` | CLI |
| `pino` | `10.3.1` | Structured logs |
| `undici` | `8.1.0` | HTTP clients |
| `execa` | `9.6.1` | Subprocesses |
| `glob` | `13.0.6` | File discovery (preferred over `fast-glob`) |
| `yaml` | `2.8.3` | Manual RIG YAML — must be ≥ 2.8.3 (2026 DoS advisory) |
| `smol-toml` | `1.6.1` | `pyproject.toml` |
| `better-sqlite3` | `12.9.0` | Manifest/WAL |
| `@modelcontextprotocol/sdk` | `1.29.0` | M3 MCP server only — not in M1 |

### Parser stack

| Package | Pin | Use |
| --- | --- | --- |
| `tree-sitter` | `0.25.0` | Node native parser (v1 default) |
| `tree-sitter-cli` | `0.26.8` | Grammar tooling only |
| `tree-sitter-javascript` | `0.25.0` | JS grammar |
| `tree-sitter-python` | `0.25.0` | Python grammar |
| `tree-sitter-typescript` | `0.23.2` | TS/TSX grammar |
| `web-tree-sitter` | `0.26.8` | WASM path only; do not mix 0.26.x with older WASM grammars |

Use the native Node binding by default. Adopt `web-tree-sitter` only when every grammar WASM build is explicitly controlled.

### Storage stack

| Component | Pin | Use |
| --- | --- | --- |
| Neo4j server | `5.26 LTS` | Graph store (hotfix support to 2028-06-06) |
| Neo4j LTS patch | `5.26.25` | Current LTS patch |
| `neo4j-driver` | `6.0.1` | TS graph adapter (supports 4.4, 5.x, 2025.x) |
| `@lancedb/lancedb` | `0.27.2` | TS vector store |
| `lancedb` (Python) | `0.30.2` | Optional Python tooling only |

Stay on Neo4j 5.26 LTS for v1. A jump to the 2025/2026 line is a separate scheduled evaluation, not a v1 task.

Docker compose for Neo4j (no `latest` tag):

```yaml
services:
  neo4j:
    image: neo4j:5.26-community
    ports:
      - "7474:7474"
      - "7687:7687"
    environment:
      NEO4J_AUTH: neo4j/password
      NEO4J_server_memory_heap_initial__size: 2G
      NEO4J_server_memory_heap_max__size: 4G
      NEO4J_server_memory_pagecache_size: 2G
    volumes:
      - neo4j-data:/data

volumes:
  neo4j-data:
```

For reproducible CI/prod, resolve `neo4j:5.26-community` to a digest in the deployment lockfile.

### Model server stack

| Package | Pin | Use |
| --- | --- | --- |
| `sentence-transformers` | `5.4.1` | Default local embed/rerank |
| `transformers` | `5.7.0` | HF model runtime (satisfies Qwen3 `>=4.51.0`) |
| `torch` | `2.11.0` | Tensor backend |
| `fastapi` | `0.136.1` | Model-server API |
| `uvicorn` | `0.46.0` | ASGI server |
| `pydantic` | `2.13.3` | Python DTOs |
| `pydantic-settings` | `2.14.0` | Config |
| `vllm` | `0.20.1` | Optional server backend |

Model-server `pyproject.toml`:

```toml
[project]
requires-python = ">=3.13,<3.14"
dependencies = [
  "fastapi==0.136.1",
  "uvicorn==0.46.0",
  "pydantic==2.13.3",
  "pydantic-settings==2.14.0",
  "sentence-transformers==5.4.1",
  "transformers==5.7.0",
  "torch==2.11.0"
]

[project.optional-dependencies]
vllm = [
  "vllm==0.20.1"
]
graph-algos = [
  "networkx==3.6.1",
  "igraph==1.0.0",
  "leidenalg==0.11.0"
]
```

### Graph algorithms (v1.1+)

| Package | Pin | Use |
| --- | --- | --- |
| `networkx` | `3.6.1` | k-core, graph metrics |
| `igraph` | `1.0.0` | High-performance graph |
| `leidenalg` | `0.11.0` | Leiden CPM |
| `graspologic` | `3.4.4` | Optional; only adopt if explicitly chosen |

### Model revision pinning

Pin Qwen models by Hugging Face revision SHA, not just by name. Persist both the model name and the resolved revision in the index manifest:

```json
{
  "embedding_model": "Qwen/Qwen3-Embedding-0.6B",
  "embedding_revision": "<hf-commit-sha>",
  "embedding_dim": 1024,
  "reranker_model": "Qwen/Qwen3-Reranker-0.6B",
  "reranker_revision": "<hf-commit-sha>"
}
```

`Qwen3-Embedding-0.6B` (0.6B params, 32K context, up to 1024-dim) requires `transformers>=4.51.0`, satisfied by `transformers==5.7.0`. `Qwen3-Reranker-0.6B` (0.6B params, 32K context) supports `sentence-transformers` `CrossEncoder`.

### Image and dependency-refresh policy

- Use exact pins in `package.json`, `pyproject.toml`, Docker images, and HF model revisions.
- Do **not** use `latest` Docker/image tags except during scheduled dependency-refresh windows.
- Resolve image tags to digests in deployment lockfiles for CI/prod reproducibility.
- Renovate/Dependabot may open weekly PRs; only merge after fixture ingestion, query golden tests, model-server contract tests, and the index rebuild determinism check pass.
- LangGraph, agent frameworks, and the MCP SDK remain out of scope for M1. The MCP SDK pin (`@modelcontextprotocol/sdk@1.29.0`) belongs to M3.

## 🧷 Highest-priority guardrails

<aside>
⚠️

1. v1 must prove **graph traversal and architecture localization**, not only vector retrieval.
2. v1 acceptance covers **500K–2M tokens**; do not silently shrink to 500K.
3. RIG is **pluggable from day one**. SPADE is one extractor among several, not deferred.
4. **No claim of atomic cross-store writes.** Use batch manifests + idempotent upserts.
5. North-star is **repository localization and architecture QA**, not HumanEval pass@1.
6. **No hardcoded local model runtimes.** Everything goes through `Embedder`, `Reranker`, `Summarizer`.
7. **No blanket 512-token truncation.** Use adaptive function/block indexing.
8. **Pin exact versions** for runtimes, packages, Docker images, and Hugging Face model revisions. No `latest` tags outside scheduled dependency-refresh windows.
</aside>

[Phase 0 — Interfaces & Core Schema](Phase0-Interfaces-Core-Schema.md)

[Phase 0 — TDD Plan & Contract Precision](Phase0-TDD-Plan-Contract-Precision.md)

[CodeSoul Review — Phase 0 → v1 Plan](Phase0-Plan-v1.md)
