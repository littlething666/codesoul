# CodeSoul Roadmap

CodeSoul is a repository architecture extraction layer. This roadmap tracks capability gates and current maturity.

## Capability Gates

### Gate A — Scaffold (✅ landed)
- ESM-only monorepo with `tsup` + `vitest`
- Core DTOs: `GraphNode`, `GraphEdge`, `VectorRow`, `ContextBundle`
- `GraphStore`, `VectorStore`, `Embedder`, `Reranker`, `Parser` interfaces
- Mock implementations for every interface
- `FixtureIndexer` end-to-end skeleton with deterministic hashing

### Gate B — Real parser + durable manifest (✅ landed)
- `TreeSitterParser` for TS/JS/Python with `CONTAINS`, `CALLS`, `IMPORTS` edges
- `ManifestStore` interface with `InMemoryManifestStore` + `SqliteManifestStore`
- WAL with `batch_manifest`, `batch_event`, `ingestion_manifest` tables
- `RigExtractor` interface with `PackageJson`, `PyProject`, `ManualYAML`, `SpadeCMake` extractors
- `RigDispatcher` for multi-extractor pipelines

### Gate C — Real adapter seams (✅ landed)
- `Neo4jGraphStore` (Phase 3): Cypher-backed, idempotent migrations, BFS traversal
- `HttpEmbedder` / `HttpReranker` with `Fallback*` + `LatencyLogging*` wrappers (Phase 5)
- `LanceDBVectorStore` (Phase 6)
- Python model server with FastAPI + Pydantic, stub and `sentence-transformers` backends
- Model identity verification at the response boundary
- `wireRuntime` wiring factory with CLI flag mapping

### Gate D — Architecture retrieval quality (🔄 in progress)
- ✅ Real graph export with deterministic sort (`codesoul graph export`)
- ✅ Persistent local profile: sqlite manifest store + `codesoul doctor`
- ✅ Block extraction for long functions/methods (TS/JS/Python, gated by 512 tokens / 60 lines)
- ✅ `--profile local-persist` convenience flag
- ✅ Memory-backed query warning
- ✅ Non-empty architecture query goldens ("what calls greet" returns greetMany, "where is greet defined" returns correct file)
- ✅ `RuntimeDeps` / `wireRuntime` naming (backwards-compatible aliases)
- 🚧 Small retrieval eval harness
- 🚧 Fixture generator for scale tests
- 🚧 Persistent index → query flow across processes (Neo4j + LanceDB)

### Gate E — Scale + acceptance (planned)
- 100K–300K token fixture in CI
- 500K–2M token fixture in nightly
- Recall@10 metrics (symbol ≥85%, file ≥90%)
- Deterministic graph/vector export diff
- `local-persist` profile documented

## Implemented Commands

| Command | Status | Description |
| ------- | ------ | ----------- |
| `index` | ✅ | Index a repository (dry-run or persist) |
| `query` | ✅ | Hybrid retrieval (exact + semantic + graph expand) |
| `inspect nodes` | ✅ | List graph nodes with filters |
| `inspect edges` | ✅ | List graph edges with filters |
| `inspect vectors` | ✅ | List vectors for an index run |
| `graph export` | ✅ | Export graph as JSON with repo/index-run filters |
| `doctor` | ✅ | Health check of all configured backends |

## Backend Support Matrix

| Component | Memory/Mock | Persisted |
| --------- | ----------- | --------- |
| Parser | `regex` (MockParser) | `tree-sitter` |
| Graph Store | `memory` (MockGraphStore) | `neo4j` |
| Vector Store | `memory` (MockVectorStore) | `lancedb` |
| Manifest Store | `memory` (InMemoryManifestStore) | `sqlite` |
| Embedder | `mock` (MockEmbedder) | `http` |
| Reranker | `mock` (MockReranker) | `http` |

## Profile: `local-persist`

A convenience profile that sets all backends to persisted mode:

```bash
export CODESOUL_NEO4J_URL=bolt://localhost:7687
export CODESOUL_NEO4J_USER=neo4j
export CODESOUL_NEO4J_PASSWORD=password
export CODESOUL_VECTOR_STORE_URI=/tmp/codesoul-vectors

codesoul index ./fixtures/tiny-ts-lib \
  --graph-store neo4j \
  --vector-store lancedb \
  --manifest-store sqlite

codesoul query "what calls greet" \
  --repo ./fixtures/tiny-ts-lib \
  --graph-store neo4j \
  --vector-store lancedb
```

## Storage Conventions

- Manifest DB: `.codesoul/manifest.db` (SQLite, WAL mode)
- LanceDB vectors: `CODESOUL_VECTOR_STORE_URI` directory
- Neo4j: one `:Symbol` label, edges as relationships
