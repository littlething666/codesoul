# CodeSoul

**CodeSoul** is a repository **architecture extraction layer** — not a vector retrieval toy. Every node and edge in the graph traces back to evidence in code, and every result is explainable.

This repository is the **Phase 0** scaffold: a compiling, end-to-end skeleton with every architectural seam expressed as an interface and backed by deterministic mocks. No external services, no native parsers, no Neo4j, no LanceDB, no model server.

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
  parser/                # Parser interface + MockParser
  rig/                   # RigExtractor interface + MockRigExtractor
  graph-store/           # GraphStore interface + MockGraphStore
  vector-store/          # VectorStore interface + MockVectorStore
  embedder/              # Embedder interface + MockEmbedder
  reranker/              # Reranker interface + MockReranker
  summarizer/            # Summarizer interface + MockSummarizer
  retrieval/             # Hybrid retrieval skeleton
  indexer/               # Index pipeline state machine + FixtureIndexer
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
