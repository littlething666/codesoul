<aside>
📝

Review of the uploaded Phase 0 codebase against the proposed bottom-up v1 plan. Approve with changes — close interface-level gaps before tree-sitter, split the parser milestone, move manifest/WAL earlier.

</aside>

I reviewed the uploaded current codebase and the proposed bottom-up plan. The direction is sound: Phase 0 now has a credible mock-driven skeleton with packages for core schema, parser, RIG, graph store, vector store, embedder, reranker, retrieval, and indexer, plus a CLI wired through injectable dependencies. The uploaded tree also shows the TDD improvements have started landing: `edge-hash.test.ts`, `schema.test.ts`, mock seam tests, `build-batch.test.ts`, retrieval pipeline tests, and CLI command tests are present.

My main recommendation: **do not rush directly into tree-sitter.** First close several interface-level gaps that will otherwise create churn in Phase 1–5.

---

## 🎯 Executive Verdict

**Approve the plan with changes.**

The bottom-up sequence is broadly right:

```
real parser → durable manifest/WAL → Neo4j → model server → LanceDB → RIG → blocks → inspect/eval
```

But I would change four things:

1. **Move manifest/WAL before tree-sitter or parallelize it with tree-sitter.**
2. **Add missing list/query inspection methods to `GraphStore` and `VectorStore` before real adapters.**
3. **Introduce `EmbedInput.kind` now, before HTTP embedder/model-server work.**
4. **Split "real parser" into smaller parser milestones: imports first, methods second, calls third, blocks later.**

---

## ❓ Review of the Open Questions

### Q1. Schema: should `id` and `contentHash` stay separate?

**Answer: yes, keep current shape.**

Current schema already has:

```tsx
id: stable node identity
contentHash: persisted content identity
```

That is correct. The ambiguity is that `contentHash` means different things by record type:

| Record | `contentHash` means |
| --- | --- |
| `GraphNode` | node content identity |
| `GraphEdge` | edge identity hash |
| `VectorRow` | source node content identity |

That is acceptable if documented.

#### Improvement

Add JSDoc directly on `PersistedMeta`:

```tsx
/**
 * contentHash is a persisted record hash.
 *
 * For GraphNode: contentId(normalizedSignature, normalizedBody)
 * For GraphEdge: edgeContentHash(src, type, dst)
 * For VectorRow: contentHash of the source node payload
 */
export const PersistedMeta = ...
```

I would **not** rename it now. A rename to `recordHash` or splitting fields by DTO would be cleaner, but it adds churn without much v1 value.

---

### Q2. Where do `IMPORTS` and `CALLS` edges come from before tree-sitter?

**Answer: skip them in regex parser.**

Agreed. Keep `MockParser` intentionally shallow.

#### Suggested refinement

Tree-sitter Phase 1 should not try to do full import and call resolution in one step. Split it:

```
P1a: File, Class, Function, Method, Import nodes
P1b: IMPORTS edges with local file resolution
P1c: naive CALLS edges inside same file
P2: cross-file call resolution
```

Reason: method extraction and import extraction are structural; call resolution is semantic and will become messy fast.

---

### Q3. Should `GraphStore.query(cypher)` be on the cross-backend interface?

**Answer: no. Keep it off `GraphStore`.**

Agreed.

The core store should stay backend-agnostic. Cypher belongs on the Neo4j adapter only.

#### Add to `GraphStore` instead

Before implementing Neo4j, extend the typed interface:

```tsx
export type ListNodesOptions = {
  kind?: NodeKind
  pathGlob?: string
  repoId?: string
  indexRunId?: string
  limit?: number
}

export type ListEdgesOptions = {
  type?: EdgeType
  repoId?: string
  indexRunId?: string
  limit?: number
}

export interface GraphStore {
  upsertNodes(...)
  upsertEdges(...)
  getNode(...)
  neighbors(...)
  findByQualifiedName(...)
  listNodes(options?: ListNodesOptions): Promise<GraphNode[]>
  listEdges(options?: ListEdgesOptions): Promise<GraphEdge[]>
  health(): Promise<{ ok: boolean; details?: string }>
}
```

This enables `inspect nodes`, `inspect edges`, and graph export without leaking Cypher.

#### Neo4j-only escape hatch

```tsx
export class Neo4jGraphStore implements GraphStore {
  async cypher(...) { ... }
}
```

Do not expose `cypher()` to retrieval or CLI commands except an explicitly marked debug command later.

---

### Q4. Manifest store: JSON files or `better-sqlite3`?

**Answer: SQLite from the start.**

Agreed.

The WAL is central to the architecture review's "no fake atomicity" rule. JSON files become annoying the moment you need retries, status transitions, and inspection.

#### Recommended schema

```sql
CREATE TABLE batch_manifest (
  batch_id TEXT PRIMARY KEY,
  index_run_id TEXT NOT NULL,
  repo_id TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_content_hash TEXT NOT NULL,
  status TEXT NOT NULL,
  node_count INTEGER NOT NULL,
  edge_count INTEGER NOT NULL,
  vector_count INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  committed_at TEXT,
  checksum TEXT NOT NULL,
  schema_version INTEGER NOT NULL
);

CREATE TABLE batch_event (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  message TEXT,
  FOREIGN KEY(batch_id) REFERENCES batch_manifest(batch_id)
);
```

#### Add one more table

```sql
CREATE TABLE ingestion_manifest (
  index_run_id TEXT PRIMARY KEY,
  repo_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  embedding_model TEXT NOT NULL,
  embedding_revision TEXT NOT NULL,
  embedding_dim INTEGER NOT NULL,
  reranker_model TEXT,
  reranker_revision TEXT,
  tokenizer_version TEXT NOT NULL,
  schema_version INTEGER NOT NULL
);
```

This lets LanceDB and Neo4j adapters validate model/schema compatibility.

---

### Q5. How is the Python model server launched in dev?

**Answer: use explicit profile-based startup, never implicit fallback in CI.**

Mostly agree with the recommendation, but I would tighten the fallback behavior.

#### Recommended behavior

| Environment | Behavior |
| --- | --- |
| Local dev | missing `CODESOUL_EMBEDDER_URL` may fall back to mock with warning |
| PR CI | mocks only unless test explicitly starts model server |
| Nightly CI | model server required |
| Production | missing URL is fatal |

#### Implementation

```tsx
type EmbedderMode = "mock" | "http"

const mode = process.env.CODESOUL_EMBEDDER_MODE ?? "mock"

if (mode === "http" && !process.env.CODESOUL_EMBEDDER_URL) {
  throw new AdapterUnavailableError("CODESOUL_EMBEDDER_URL is required")
}
```

Do not make "URL unset → mock" universal. That creates silent false positives.

---

### Q6. RIG dispatch order when multiple extractors match?

**Answer: run all matching extractors, but make precedence explicit.**

Agreed with running all matching extractors. Priority-only dispatch loses useful metadata in polyglot repos.

#### Recommended merge policy

1. Run all enabled extractors.
2. Prefix IDs by extractor namespace.
3. Merge components, targets, tests.
4. Apply `ManualYamlRigExtractor` overrides last.
5. Fail on unresolved collisions unless manual YAML explicitly resolves them.

#### ID examples

```
pkg:tiny-ts-lib
py:tiny-python-lib
manual:api-service
spade:libfoo
```

#### CLI flags

```
--rig package-json,pyproject,manual
--enable-spade
--no-rig
```

Keep SPADE opt-in until subprocess hardening is complete.

---

### Q7. Block extraction trigger

**Answer: use heuristic in Phase 1.5, tokenizer in Phase 2.**

Agreed.

Do not block block extraction on Qwen tokenizer integration.

#### Recommended v1.5 trigger

Emit blocks when either condition is true:

```
function estimatedTokens > 512
or function lineSpan > 60
```

Use:

```tsx
estimatedTokens = Math.ceil(byteLength / 3.5)
```

#### Important

Keep `Block` nodes under the same identity model:

```tsx
stableId(repoId, path, "Block", `${parentQualifiedName}#block:${ordinal}`)
contentId(blockSignature, blockBody)
```

Do not derive block IDs from line numbers.

---

### Q8. Wiring `Summarizer` into CLI

**Answer: yes, add it to `Phase0Deps`, but do not invoke it in v1 indexing.**

Agreed.

Current `summarizer` exists as a package, but `Phase0Deps` does not include it. Add it now so the seam is consistently wired.

#### Change

```tsx
import { MockSummarizer } from "@codesoul/summarizer/mock"
import type { Summarizer } from "@codesoul/summarizer"

export type Phase0Deps = {
  ...
  summarizer: Summarizer
}
```

Then:

```tsx
const summarizer = new MockSummarizer()
return { ..., summarizer }
```

#### Retrieval behavior

Retrieval should accept optional summaries later, but should not require `Summarizer` unless it actually generates missing summaries.

---

### Q9. Vector search should accept optional filter

**Answer: yes, add before LanceDB.**

Agreed. This is an interface-level concern. Add now while only mocks exist.

#### Recommended interface

```tsx
export type VectorSearchFilter = {
  repoId?: string
  indexRunId?: string
  payloadKind?: VectorRow["payloadKind"]
}

export interface VectorStore {
  upsert(rows: ReadonlyArray<VectorRow>): Promise<void>
  search(query: {
    vector: number[]
    limit: number
    filter?: VectorSearchFilter
  }): Promise<VectorSearchHit[]>
  listByRun(indexRunId: string, options?: { limit?: number }): Promise<VectorRow[]>
  countByRun(indexRunId: string): Promise<number>
  health(): Promise<{ ok: boolean; details?: string }>
}
```

#### Why this matters

Without filters, a long-lived local LanceDB table will cross-contaminate results across repos and index runs.

---

### Q10. Where does query embedding's `nodeId` go?

**Answer: add a discriminator now.**

Agreed. `"__query__"` is acceptable in Phase 0 tests, but should not leak into the durable contract.

#### Change `EmbedInput`

```tsx
export const EmbedInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("node"),
    nodeId: z.string().regex(/^sym_[0-9a-f]{40}$/),
    contentHash: z.string().regex(/^cnt_[0-9a-f]{40}$/),
    payloadKind: z.enum(["FunctionSummary", "Block", "Markdown"]),
    text: z.string()
  }),
  z.object({
    kind: z.literal("query"),
    queryId: z.string().min(1),
    text: z.string()
  })
])
```

#### Change `EmbeddingResult`

```tsx
export const EmbeddingResult = z.object({
  inputKind: z.enum(["node", "query"]),
  nodeId: z.string().optional(),
  queryId: z.string().optional(),
  vector: z.array(z.number().finite()).length(EMBEDDING_DIM),
  embeddingModel: z.string(),
  embeddingRevision: z.string(),
  embeddingDim: z.literal(EMBEDDING_DIM)
})
```

#### Guardrail

`VectorStore.upsert()` accepts only `VectorRow`, not `EmbeddingResult`, so query vectors cannot be persisted unless explicitly converted. Keep that separation.

---

### Q11. Token budget enforcement in `assembleContext`

**Answer: add estimator in Phase 1, but add interface now.**

Current `tokenBudget.used = 0` is fine for Phase 0, but the context assembly seam should anticipate token accounting.

#### Add interface

```tsx
export interface TokenEstimator {
  estimate(text: string): number
}

export class ByteTokenEstimator implements TokenEstimator {
  estimate(text: string): number {
    return Math.ceil(Buffer.byteLength(text, "utf8") / 3.5)
  }
}
```

#### Add to retrieval input

```tsx
export type RetrievalDeps = {
  ...
  tokenEstimator?: TokenEstimator
}
```

Default to `ByteTokenEstimator`.

---

### Q12. Determinism of `FixtureIndexer.sourceContentHash`

**Answer: fix now.**

Strong agreement.

Hashing only `repoPath` is wrong. The manifest hash should change when file contents change and remain stable across absolute path moves if relative paths and contents are identical.

#### Add helper

```tsx
export type SourceFileDigest = {
  relativePath: string
  sha1: string
}

export const sourceTreeContentHash = (
  files: ReadonlyArray<SourceFileDigest>
): string => {
  const sorted = [...files].sort((a, b) =>
    a.relativePath.localeCompare(b.relativePath)
  )
  return `cnt_${hashParts(sorted.flatMap((f) => [f.relativePath, f.sha1]))}`
}
```

Use it after walking files and reading bytes.

#### Important

Do **not** hash absolute paths.

---

## 🛠️ Additional Codebase Improvements

### 1. Add `listNodes` / `listEdges` before implementing inspection

Current inspect commands are stubs. That is okay for Phase 0, but the next useful bottom-up move is not Neo4j; it is typed listing support in `GraphStore`.

#### Add tests first

```
MockGraphStore.listNodes filters by kind
MockGraphStore.listNodes filters by path glob/prefix
MockGraphStore.listEdges filters by type
MockGraphStore.listEdges filters by repoId/indexRunId
```

Then wire:

```
codesoul inspect nodes
codesoul inspect edges
```

against the mock store. This keeps inspection CLI real before Neo4j.

---

### 2. Make `buildBatch` the stable parser/indexer contract

The uploaded tree already includes `packages/indexer/src/build-batch.ts` and `build-batch.test.ts`, which is the right direction.

I would formalize this:

```
FixtureIndexer = filesystem orchestration
buildBatch = deterministic transformation
```

#### `buildBatch` should own

```
Parse files
Collect nodes/edges
Create embed inputs
Compute batch checksum
Return deterministic batch payload
```

#### `FixtureIndexer` should own

```
Walk filesystem
Read files
Call RIG extractor
Call buildBatch
Call embedder
Upsert graph/vector stores
Create/transition manifest
```

This makes Phase 1 parser replacement easier.

---

### 3. Create adapter packages instead of placing real adapters in seam packages

Do not put Neo4j or LanceDB dependencies into the current seam packages.

Use:

```
packages/graph-store              # interface + mock
packages/graph-store-neo4j         # real adapter
packages/vector-store              # interface + mock
packages/vector-store-lancedb      # real adapter
packages/embedder                  # interface + mock
packages/embedder-http             # real HTTP adapter
packages/reranker                  # interface + mock
packages/reranker-http             # real HTTP adapter
```

This preserves the "no vendor types above adapter boundary" rule.

---

### 4. Add a `RepositoryProfile` / `IndexConfig` DTO before more CLI flags

As soon as you add parser mode, store mode, RIG mode, embedding mode, and SPADES flags, CLI code will bloat.

Add a core config schema:

```tsx
export const IndexConfig = z.object({
  parser: z.enum(["regex", "tree-sitter"]).default("regex"),
  graphStore: z.enum(["memory", "neo4j"]).default("memory"),
  vectorStore: z.enum(["memory", "lancedb"]).default("memory"),
  embedder: z.enum(["mock", "http"]).default("mock"),
  reranker: z.enum(["mock", "http"]).default("mock"),
  rigExtractors: z.array(z.enum(["package-json", "pyproject", "manual", "spade"])),
  enableSpade: z.boolean().default(false)
})
```

CLI parses flags into `IndexConfig`; wiring uses it.

---

### 5. Add `RepositoryId` generation policy

Right now CLI defaults to:

```tsx
repoId: "repo_fixture"
```

That is fine for Phase 0, but v1 needs a deterministic default.

#### Recommended

```tsx
repoId = "repo_" + hashParts([normalizedRepoRootName, remoteOriginUrl ?? absolutePath])
```

Better:

1. Use `package.json.name` / `pyproject.project.name` if available.
2. Include Git remote URL if available.
3. Fall back to absolute path hash.

Keep explicit `--repo-id` override.

---

### 6. Add `sourceText` retrieval seam before context assembly

Current `ContextBundle.snippets[].text` is empty in Phase 0 retrieval. That is acceptable for tests, but v1 needs text.

Do not make `GraphStore` responsible for file contents.

Add:

```tsx
export interface SourceProvider {
  readRange(path: string, lines: [number, number]): Promise<string>
}
```

Phase 0 can use:

```tsx
MockSourceProvider
```

Phase 1 can use:

```tsx
FileSystemSourceProvider
```

Then retrieval can assemble actual snippet text.

---

## 🔁 Review of the Proposed Phase Plan

### Phase 1 — Real parser + IDs hardening

**Change this phase.**

The phase is too large. Split it.

#### Phase 1A — Parser package scaffold

```
Add parser-tree-sitter package
Load grammars
Parse files
Emit File/Class/Function/Method nodes only
No IMPORTS/CALLS yet
Golden tests against fixtures
```

#### Phase 1B — Imports

```
Emit Import nodes
Emit IMPORTS edges
Resolve local TS/JS imports to File nodes
Resolve Python imports only as Import nodes, no full resolution yet
```

#### Phase 1C — Calls

```
Emit naive CALLS edges intra-file only
Function calls by identifier
Method calls later
```

#### Phase 1D — Parser feature flag removal

```
Default to tree-sitter
Keep regex parser only for mock tests
```

Reason: full parser + imports + calls + method extraction in one milestone is too risky.

---

### Phase 2 — Manifest + WAL persistence

**Move earlier or parallelize with Phase 1.**

I would make this **Phase 1B parallel** or even Phase 1A, because it is parser-independent and unlocks durable indexing.

#### Revised order

```
P1: Core interface hardening
P2: Manifest/WAL
P3: Tree-sitter parser
P4: Neo4j
P5: model-server
P6: LanceDB
...
```

If you keep the current order, avoid coupling parser replacement to WAL work.

---

### Phase 3 — Neo4j graph store

**Good, but add an explicit constraint/index step.**

Required startup migration:

```
CREATE CONSTRAINT symbol_id IF NOT EXISTS
FOR (s:Symbol)
REQUIRE s.id IS UNIQUE;
```

Suggested relationship shape:

```
(:Symbol {id})-[:CALLS {repoId, indexRunId, batchId, contentHash, sourcePath, schemaVersion}]->(:Symbol {id})
```

#### Use one label plus kind property

Prefer:

```
(:Symbol { id, kind })
```

over dynamic labels like `:Function`, `:Class`, etc. You can add secondary labels later, but a single base label simplifies constraints and generic inspection.

---

### Phase 4 — Python model-server + HTTP embedder/reranker

**Good, but split embedder and reranker readiness.**

Do not block HTTP embedding on reranker.

#### Suggested split

```
P4a: /embed endpoint + HttpEmbedder
P4b: /rerank endpoint + HttpReranker
P4c: timeout + fallback + latency logging
```

Also add model contract tests with small fake HTTP server before starting Python.

---

### Phase 5 — LanceDB vector store

**Good, but add manifest compatibility check before search.**

The LanceDB adapter should refuse to search if the query embedder identity does not match stored vector identity.

#### Rule

```
query.embeddingModel === tableManifest.embeddingModel
query.embeddingRevision === tableManifest.embeddingRevision
query.embeddingDim === tableManifest.embeddingDim
```

Otherwise throw:

```tsx
EmbeddingCompatibilityError
```

Add this error class now.

---

### Phase 6 — RIG extractors

**Good, but PackageJson/PyProject should land before SPADE.**

Split:

```
P6a: PackageJsonRigExtractor
P6b: PyProjectRigExtractor
P6c: ManualYamlRigExtractor
P6d: SpadeCMakeRigExtractor
P6e: RigDispatcher merge
```

SPADE should remain opt-in until versioned JSON validation and subprocess timeout are in place.

---

### Phase 7 — Block extraction

**Good, but place after `SourceProvider`.**

Blocks need reliable source slices. Add `SourceProvider` first.

Also add a dedupe rule:

```
If a Block node is emitted for a long function, retrieval may return either parent Function or child Block.
If both are in final top-10, prefer Block unless query matched exact function name.
```

---

### Phase 8 — Inspection CLI + graph export

**Move partial inspection earlier.**

Mock-backed inspection should land before Neo4j:

```
inspect nodes
inspect edges
inspect vectors
inspect query
```

Then later real adapters make those commands useful with persisted stores.

Graph export can wait until Neo4j, but `inspect query` should land as soon as retrieval has stage-level debug output.

---

### Phase 9 — Eval harness

**Start tiny evals earlier.**

Do not wait until Phase 9 to add evaluation. Add a minimal eval harness after tree-sitter:

```
fixtures/tiny-ts-lib eval:
- query "greet" should localize src/greet.ts::greet
- query "Farewell" should localize src/farewell.ts::Farewell
- query "what calls greet" should include greetMany after CALLS exists
```

Later expand to medium/large fixtures.

---

### Phase 10 — MCP server

**Correctly deferred.**

No change.

---

## 🪜 Revised Bottom-Up Plan

I recommend this adjusted order:

### Phase 0.5 — Interface hardening

Before real adapters:

- Add `Summarizer` to `Phase0Deps`.
- Add `VectorStore.search.filter`.
- Add `VectorStore.listByRun`.
- Add `GraphStore.listNodes/listEdges`.
- Add `EmbedInput.kind`.
- Add `TokenEstimator`.
- Add `SourceProvider` interface.
- Fix `sourceContentHash`.
- Add `IndexConfig` DTO.

### Phase 1 — Manifest/WAL

- `packages/manifest-store`
- SQLite schema
- batch events
- durable transitions
- `inspect manifest`

### Phase 2 — Tree-sitter parser

Split into:

```
2A: File/Class/Function/Method
2B: Import nodes + IMPORTS edges
2C: naive intra-file CALLS
```

### Phase 3 — Neo4j graph store

- adapter package
- migrations
- list/traversal parity with mock
- docker-compose healthcheck

### Phase 4 — SourceProvider + real context snippets

- filesystem source provider
- context assembly with real text
- token estimator trimming

### Phase 5 — HTTP embedder/reranker

- fake HTTP contract tests
- model server
- timeout/fallback
- latency logs

### Phase 6 — LanceDB

- adapter
- manifest compatibility
- vector filters
- listByRun

### Phase 7 — RIG extractors

- PackageJson
- PyProject
- ManualYaml
- SPADE opt-in
- dispatcher merge

### Phase 8 — Blocks

- gated block extraction
- block embeddings
- parent/block dedupe

### Phase 9 — Inspection + graph export completion

- all inspect commands backed by real stores
- graph export JSON/GraphML

### Phase 10 — Evaluation harness

- symbol/file localization
- architecture QA
- p95 retrieval latency
- 500K–2M nightly fixture

### Phase 11 — MCP server

- query
- neighbors
- traversal
- inspect

---

## ✏️ Concrete Edits to the Current Plan

### Replace the gap analysis row for retrieval

Current:

```
exact → semantic → graph (1 hop) → rerank
```

Better:

```
exact → semantic → graph expansion → merge → rerank → assemble
```

Add gap:

```
missing stage-level debug output, token accounting, source snippet loading
```

---

### Replace Q3 answer with interface additions

Current answer says keep `query` off interface. Keep that, but add:

```
Add listNodes/listEdges to GraphStore now.
```

---

### Replace Q5 answer with environment-specific behavior

Current answer says fallback to mock if URL unset. Replace with:

```
Local dev may fallback to mock.
CI/prod must fail unless explicitly configured for mock mode.
```

---

### Replace Q6 answer with collision policy

Add:

```
ManualYaml overrides only when it explicitly references the colliding component id.
Otherwise collisions fail.
```

---

### Replace Phase 1 with four parser subphases

Do not put methods, imports, calls, and block chunking in one parser milestone.

---

### Move Manifest/WAL before Neo4j and before LanceDB

Current Phase 2 is fine, but I would not let it wait behind a large parser milestone.

---

## ⭐ Highest-Priority Recommendations

<aside>
⚠️

1. **Add interface hardening phase before real adapters.**
2. **Add `listNodes/listEdges`, vector filters, and `EmbedInput.kind` now.**
3. **Fix `sourceContentHash` before SQLite/WAL.**
4. **Split tree-sitter parser work into node extraction, imports, and calls.**
5. **Move minimal evals earlier, immediately after tree-sitter + retrieval can localize real symbols.**
6. **Do not let model-server fallback to mock outside explicit local/mock mode.**
7. **Keep Cypher out of `GraphStore`; add typed inspection APIs instead.**
</aside>

With those edits, the plan becomes less "big-bang v1" and more mechanically verifiable. It also keeps the core architectural claim intact: CodeSoul results must be explainable through node identity, edge traversal, evidence, and reproducible index manifests.
