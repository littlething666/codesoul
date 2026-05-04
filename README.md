# CodeSoul

**CodeSoul** is a repository **architecture extraction layer** — not a vector retrieval toy. Every node and edge in the graph traces back to evidence in code, and every result is explainable.

This repository tracks the staged build-out from the **Phase 0** scaffold (compiling, end-to-end skeleton with deterministic mocks) toward the production design described in the planning doc. Phases 0–2C, 3, and 7a–7e are landed; Phase 5 (HTTP embedder/reranker + Python model server) is the active surface.

See `Phase 0 — Interfaces & Core Schema` (in the planning doc) for the full design.

## Quick start

```bash
pnpm install
pnpm -r build
pnpm -r typecheck
pnpm -r test

# Smoke-run the CLI against the tiny TS fixture (mocks only)
pnpm --filter @codesoul/cli exec node dist/bin.js index ./fixtures/tiny-ts-lib --dry-run
```

## Workspace

```
apps/
  cli/                   # Commander v14.0.3, ESM-only
packages/
  core/                  # DTOs, IDs, manifests, errors, constants
  parser/                # Parser interface + MockParser + TreeSitterParser
  rig/                   # RigExtractor interface + dispatcher + per-format extractors
  graph-store/           # GraphStore interface + MockGraphStore
  graph-store-neo4j/     # Neo4j 5.26-LTS adapter (Phase 3)
  vector-store/          # VectorStore interface + MockVectorStore
  embedder/              # Embedder interface + MockEmbedder
  embedder-http/         # HttpEmbedder + FallbackEmbedder + LatencyLoggingEmbedder (Phase 5)
  reranker/              # Reranker interface + MockReranker
  reranker-http/         # HttpReranker + FallbackReranker + LatencyLoggingReranker (Phase 5)
  summarizer/            # Summarizer interface + MockSummarizer
  retrieval/             # Hybrid retrieval skeleton
  indexer/               # Index pipeline state machine + FixtureIndexer
  manifest-store/        # Durable batch/WAL store (memory + sqlite)
workers/
  model-server/          # FastAPI + Pydantic model server (Phase 5)
fixtures/
  tiny-ts-lib/           # ~5K LOC TS fixture
  tiny-python-lib/       # ~5K LOC Python fixture
```

## Phase 0 guardrails

- ESM-only by policy (`"type": "module"`, NodeNext resolution, `.js` extensions on relative imports).
- All seam implementations hide vendor types behind interfaces.
- Every persisted DTO is Zod-validated and carries `repoId`, `indexRunId`, `batchId`, `contentHash`, `schemaVersion` via `PersistedMeta`.
- DTOs use camelCase. Adapters may translate to backend-specific naming.
- Every package subpath is declared in `"exports"` (including `./mock`).
- No `require`, no `__dirname`, no CJS shims.

## Neo4j graph store (Phase 3)

The `memory` (in-process `MockGraphStore`) backend stays the default for tests and dry-runs. To run against a real Neo4j 5.26-LTS instance:

```bash
# 1. Start Neo4j (docker-compose.yml ships a 5.26-community service)
docker compose up -d --wait neo4j

# 2. Point the CLI at it
export CODESOUL_NEO4J_URL=bolt://localhost:7687
export CODESOUL_NEO4J_USER=neo4j
export CODESOUL_NEO4J_PASSWORD=password
# Optional; defaults to "neo4j".
export CODESOUL_NEO4J_DATABASE=neo4j

# 3. Use --graph-store neo4j on either command
pnpm --filter @codesoul/cli exec node dist/bin.js \
  index ./fixtures/tiny-ts-lib --graph-store neo4j
```

Migrations (a unique constraint on `(:Symbol).id` plus BTREE indexes for the dimensions retrieval and inspection filter by) are applied **idempotently on first write**, so a brand-new database does not need an out-of-band bootstrap step before the first `index` run. Operators who prefer to migrate explicitly can call `Neo4jGraphStore.runMigrations()` directly; the second invocation from the lazy path is a no-op because every statement uses `IF NOT EXISTS`.

Unlike the HTTP embedder/reranker, there is **no** `CODESOUL_NEO4J_FALLBACK=memory` knob: graph identity is persisted, so silently swapping backends would let later traversals read across incompatible stores. Missing env vars throw `AdapterUnavailableError` instead.

## HTTP embedder / reranker (Phase 5)

The `mock` backend stays the default for tests and dry-runs. To run against the real model server:

```bash
# 1. Start the Python model server (stub backends, no GPU required)
cd workers/model-server
python -m venv .venv && source .venv/bin/activate
pip install -e .[dev]
codesoul-model-server  # listens on 0.0.0.0:8000

# 2. Point the CLI at it
export CODESOUL_EMBEDDER_URL=http://localhost:8000/embed
export CODESOUL_EMBEDDER_MODEL=stub-embedder
export CODESOUL_EMBEDDER_REVISION=0
export CODESOUL_RERANKER_URL=http://localhost:8000/rerank
export CODESOUL_RERANKER_MODEL=stub-reranker
export CODESOUL_RERANKER_REVISION=0

# Optional: degrade to mock if the server is down
export CODESOUL_EMBEDDER_FALLBACK=mock
export CODESOUL_RERANKER_FALLBACK=mock

# Optional: emit a pino-shaped record on every embed/rerank call with
# { adapter, modelId, modelRevision, count, durationMs }. Truthy:
# "1", "true", "yes" (case-insensitive). Off by default.
export CODESOUL_LOG_LATENCY=1

# 3. Use --embedder/--reranker http on either command
pnpm --filter @codesoul/cli exec node dist/bin.js \
  query "greet" --repo ./fixtures/tiny-ts-lib \
  --embedder http --reranker http
```

Identity is verified at the response boundary: a server replying with vectors from a different `modelId@modelRevision` raises `EmbeddingCompatibilityError` (embedder) or `AdapterUnavailableError` (reranker) instead of silently corrupting search results.

When `CODESOUL_LOG_LATENCY` is on, the **outermost** adapter (after any `FallbackEmbedder` / `FallbackReranker`) is wrapped with `LatencyLoggingEmbedder` / `LatencyLoggingReranker`, so the recorded `durationMs` includes any fallback retry — i.e. it reflects the user-visible call duration, not just the primary's.

### Real Qwen3 backends

The Python model server's `sentence-transformers` backend (gated behind the `[models]` extra in `workers/model-server/pyproject.toml`) loads `Qwen/Qwen3-Embedding-0.6B` (1024-dim) and `Qwen/Qwen3-Reranker-0.6B` via the CrossEncoder API. Per the planning doc's *Model revision pinning* guardrail, both backends require a concrete HF commit SHA — the placeholder `"0"` is rejected at construction time:

```bash
cd workers/model-server
pip install -e .[models]

export CODESOUL_MODEL_SERVER_EMBEDDER_BACKEND=sentence-transformers
export CODESOUL_MODEL_SERVER_EMBEDDER_MODEL_ID=Qwen/Qwen3-Embedding-0.6B
export CODESOUL_MODEL_SERVER_EMBEDDER_MODEL_REVISION=<hf-commit-sha>
export CODESOUL_MODEL_SERVER_RERANKER_BACKEND=sentence-transformers
export CODESOUL_MODEL_SERVER_RERANKER_MODEL_ID=Qwen/Qwen3-Reranker-0.6B
export CODESOUL_MODEL_SERVER_RERANKER_MODEL_REVISION=<hf-commit-sha>
codesoul-model-server
```

Set the matching identity on the TS side via `CODESOUL_EMBEDDER_MODEL` / `_REVISION` and `CODESOUL_RERANKER_MODEL` / `_REVISION`. See `workers/model-server/README.md` for the full env-var matrix and the opt-in real-load smoke test.
