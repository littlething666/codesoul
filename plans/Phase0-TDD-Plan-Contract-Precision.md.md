<aside>
📌

The current Phase 0 codebase is close to the right shape. The main gaps are not architectural; they are **contract precision** gaps. TDD should now pin the intended behavior of mocks, schemas, idempotency, and retrieval before Phase 1 swaps in real parsers and stores.

</aside>

## 🎯 Highest-priority changes

1. Add tests for `retrieve()` now, including graph expansion.
2. Inject `Clock` and `IdGen` into `FixtureIndexer` and `transitionStatus`.
3. Define edge `contentHash` explicitly as `sha1(src|type|dst)`.
4. Fix or explicitly pin the Python `MockParser` method behavior.
5. Add boundary validation tests for mock stores.
6. Add `fast-check` only to `@codesoul/core` tests for ID/normalization invariants.

---

## ❓ Answers to Q1–Q13

### Q1. Scope of "deterministic, pure". Do we include `retrieve()`?

**Answer: yes.**

`retrieve()` should be included because it is the first place the system proves that CodeSoul is not only indexing symbols, but assembling an explainable retrieval path.

However, the current `retrieve()` implementation does **not** yet exercise `GraphStore.neighbors()`. It only does:

```
parse query → exact lookup → semantic search → merge → rerank → assemble
```

But the intended contract is:

```
parse query → exact lookup → vector search → graph expand → merge → rerank → assemble
```

#### Recommendation

Add a test that fails until `retrieve()` calls graph expansion. Target behavior:

```
exact hit on greet
→ graph.neighbors(greet, depth=1)
→ include connected graph candidates
→ rerank
→ return snippets with citations
```

Do **not** include `FixtureIndexer` in "pure deterministic" tests yet. It performs filesystem reads and currently uses random/time.

### Q2. What does "idempotent" mean for indexing?

**Answer: split the contract into structural idempotency and run metadata volatility.**

Current `FixtureIndexer` uses:

```tsx
randomBytes(...)
new Date().toISOString()
```

So two runs cannot be byte-identical.

#### Strong idempotency (must be byte-identical for the same source input)

- `stableId`
- `contentId`
- node `kind`
- `qualifiedName`
- `signature`
- `evidence`
- edge `src`/`type`/`dst`
- vector key
- function count, edge count, vector count

#### Weak idempotency (may vary unless injected)

- `batchId`
- `createdAt`
- `committedAt`
- `indexRunId`

#### TDD improvement

Add a normalizer for snapshots:

```tsx
const stripVolatile = (x: unknown): unknown => {
	// remove batchId, indexRunId, createdAt, committedAt
}
```

Then add a second test using injected deterministic `Clock` and `IdGen` where the full output is byte-identical.

### Q3. Should `batchId` / `Date.now` be injectable?

**Answer: yes.** Do it now. It is small and unlocks deterministic snapshot tests.

Add to `packages/indexer`:

```tsx
export interface Clock {
	nowIso(): string
}

export interface IdGen {
	batchId(): string
}

export const SystemClock: Clock = {
	nowIso: () => new Date().toISOString(),
}

export const CryptoIdGen: IdGen = {
	batchId: () => `batch_${randomBytes(8).toString("hex")}`,
}
```

Update `FixtureIndexer`:

```tsx
export type FixtureIndexerDeps = IndexerDeps & {
	clock?: Clock
	idGen?: IdGen
}
```

With defaults `this.clock = deps.clock ?? SystemClock` and `this.idGen = deps.idGen ?? CryptoIdGen`.

Also update `transitionStatus`:

```tsx
export const transitionStatus = (
	manifest: BatchManifest,
	next: BatchStatus,
	clock: Clock = SystemClock,
): BatchManifest => {
	// ...
	committedAt: next === "committed" ? clock.nowIso() : manifest.committedAt
}
```

### Q4. Test framework / property-based testing?

**Answer: stay on Vitest; add `fast-check` only for core invariants.**

Do not introduce property-based testing across mocks or pipelines. It will create noise before contracts are stable.

- Use `fast-check` for: `stableId` determinism, `contentId` determinism, normalization idempotency, small-domain ID distinction.
- Keep example-based tests for: schemas, stores, parser, indexer, retrieval, CLI.

### Q5. How aggressive on Zod negative tests?

**Answer: targeted, not exhaustive.** Do not retest Zod. Test CodeSoul-specific constraints.

For every schema:

- 1 happy path
- 1 shape failure
- 1 enum failure if relevant
- 1 refine/regex/length failure if relevant

Examples:

- `GraphNode`: invalid id
- `Evidence`: `endLine < startLine`
- `VectorRow`: vector length != 1024
- `RigComponent`: invalid kind
- `BatchManifest`: invalid `sourceContentHash`

### Q6. Edge `contentHash` semantics

**Answer: switch to edge identity hash.**

Current `MockParser` sets edge `contentHash` to the child node content hash. Syntactically valid, but semantically weak — an edge is a relationship, not the child body.

Add a helper:

```tsx
export type EdgeContentHashInput = {
	src: string
	type: string
	dst: string
}

export const edgeContentHash = (input: EdgeContentHashInput): string =>
	`cnt_${sha1([input.src, input.type, input.dst])}`
```

To avoid exposing `sha1`, either move the internal helper or create an exported `hashParts()`.

Test first:

- same `src/type/dst` → same edge content hash
- different `type` → different edge content hash
- different `dst` → different edge content hash
- shape is `cnt_<40 hex>`

Then update `MockParser`.

### Q7. `MockGraphStore.neighbors` limit semantics

**Answer: pin layer-complete BFS semantics.**

Current implementation can stop mid-edge scan once `limit` is reached, dropping equally-deep neighbors based on insertion order.

Recommended contract:

```
Traversal order: BFS
Edge order:      insertion order
Layer policy:    finish the current BFS layer before applying limit
Seed node:       always included
Limit:           applies to discovered non-seed nodes
```

This avoids unstable results when several nodes are equally close. Test cases:

- depth 0 returns only seed
- depth 1 returns direct neighbors
- direction `out`/`in`/`both` works
- `edgeTypes` filter works
- limit applies after layer
- seed does not consume limit

### Q8. `findByQualifiedName` looseness

**Answer: keep it and pin it.**

Current: `n.qualifiedName === name || n.qualifiedName.endsWith("::${name}")`. Appropriate for Phase 0. Tests:

- `"greet"` matches `"src/greet.ts::greet"`
- `"src/greet.ts::greet"` matches exact
- `"bargreet"` does **not** match `"src/greet.ts::greet"`
- `"greet"` may return multiple symbols (expected)

### Q9. `MockVectorStore` key collision

**Answer: lock current behavior.** Key `${nodeId}:${payloadKind}` is correct for Phase 0. Pin:

- same `nodeId` + same `payloadKind` overwrites
- same `nodeId` + different `payloadKind` coexists
- `countByRun` counts current rows
- `search` returns sorted cosine scores

Caution: if later you want vector history across index runs, the key must become `${indexRunId}:${nodeId}:${payloadKind}`. For Phase 0, latest-row semantics are simpler and fine.

### Q10. `MockEmbedder` determinism contract

**Answer: make the invariants explicit.** The `valueAt(text, i)` design is better than folding one digest across the whole vector. Tests:

- `dimension` is `EMBEDDING_DIM`
- `embeddingDim` is `EMBEDDING_DIM`
- all values are finite
- all values are in `[-1, 1]`
- same input returns byte-identical vector
- different text changes at least one slot
- slot `i` depends on `text` and `i`

Snapshot a small prefix only — `expect(vector.slice(0, 8)).toMatchInlineSnapshot(...)`. Do not snapshot all 1024 values.

### Q11. `MockParser` coverage

**Answer: document the exact Phase 0 parser contract, then test it.**

The current Python regex does **not** only capture file-scope `def`. It captures indented methods too: `/(?:^|\n)[\t ]*def\s+.../`. So `tiny-python-lib/src/greet.py` likely emits `greet`, `__init__`, `message`, `Greeter` — but `__init__` and `message` are emitted as `Function`, not `Method`.

**Recommended Phase 0 contract:**

- Emit top-level functions/classes only
- Do not emit methods
- Do not emit arrow functions
- Do not emit class members
- Do not emit imports

Fix the Python regex to require no indentation:

```tsx
/(?:^|\n)def\s+([A-Za-z_][\w]*)\s*(\([^)]*\))/g
/(?:^|\n)class\s+([A-Za-z_][\w]*)/g
```

Golden tests:

- `tiny-ts-lib/farewell.ts` → File, Function `farewell`, Class `Farewell`
- `tiny-ts-lib/greet.ts` → File, Function `greet`, Function `greetMany`
- `tiny-ts-lib/index.ts` → File only
- `tiny-python-lib/greet.py` → File, Function `greet`, Class `Greeter`

If you instead choose to capture Python methods, then emit `Method`, not `Function`.

### Q12. `normalizeBody` strips lines starting with `#`

**Answer: pin current behavior and mark language-aware normalization for Phase 1.**

This collides with TypeScript private fields. Add tests now:

```tsx
expect(normalizeBody("class A { #x = 1 }")).toBe("class A {")
```

This looks ugly, but it pins current behavior. Add a TODO:

```tsx
// TODO Phase 1: make normalization language-aware.
// In TypeScript, #x is a private field, not a comment.
```

Do not silently fix this in Phase 0 unless you are ready to change `normalizeBody(raw)` into `normalizeBody(raw, { language })` — that is a larger interface change.

### Q13. `retrieve()` always embeds query with placeholder hash

**Answer: pin current behavior.** `cnt_0000000000000000000000000000000000000000` is fine for query payloads.

Use a recording embedder:

```tsx
expect(embedder.inputs[0]).toMatchObject({
	nodeId: "__query__",
	contentHash: "cnt_0000000000000000000000000000000000000000",
	payloadKind: "FunctionSummary",
	text: "greet",
})
```

Optimization (skip embedding when query is exact-only) can come later. Do not do that in Phase 0.

---

## 🚧 Additional current-codebase gaps

### G1. Mock stores do not Zod-validate boundary input

The guardrail says "every persisted DTO is Zod-validated at the seam boundary", but current mocks do not parse. TDD this first:

- `MockGraphStore.upsertNodes` rejects invalid `GraphNode`
- `MockGraphStore.upsertEdges` rejects invalid `GraphEdge`
- `MockVectorStore.upsert` rejects invalid `VectorRow`

Then implement:

```tsx
import { GraphNode, GraphEdge } from "@codesoul/core"

const parsed = GraphNode.parse(n)
this.nodes.set(parsed.id, parsed)
```

For TypeScript tests, use `unknown` payloads and call through a helper. Tests can use casts locally; production code should not.

### G2. `dryRun` produces a pending manifest

Current CLI dry-run returns `status: "pending"`, which is confusing because the command completed successfully.

| Option | Status | Recommendation |
| --- | --- | --- |
| Keep current | `pending` | acceptable |
| Add new status | `dry_run` | clearer |
| Return no manifest | — | weaker |

Recommendation: add `dry_run` to `BatchStatus`:

```tsx
export const BatchStatus = z.enum(["pending", "committed", "failed", "dry_run"])
```

Then `status: input.dryRun ? "dry_run" : "committed"`. If you do not want schema churn, at least add a test that pins `pending` for dry-run.

### G3. `FixtureIndexer` calls RIG but ignores it

`await this.deps.rig.extract(input.repoPath)` proves the seam is callable, but not that RIG contributes to the graph. For Phase 0 this is acceptable, but TDD should make it explicit. Use a counting extractor and assert `rig.calls === 1`. Do not require RIG graph nodes until Phase 1.

### G4. CLI option parsing needs validation

Current `limit: Number(opts.limit)` gives `NaN` on invalid input. Add test: `codesoul query greet --limit abc` exits non-zero. Implementation:

```tsx
const parsePositiveInt = (value: string): number => {
	const n = Number(value)
	if (!Number.isInteger(n) || n <= 0) {
		throw new InvalidArgumentError("must be a positive integer")
	}
	return n
}

.option("--limit <n>", "max snippets", parsePositiveInt, 10)
```

---

## 🧪 Revised TDD plan

### Phase A — Core invariants

#### A1. `packages/core/src/__tests__/ids.test.ts` (extend)

Add property-based tests:

- `stableId` is deterministic
- `contentId` is deterministic
- `stableId` shape is `sym_<40 hex>`
- `contentId` shape is `cnt_<40 hex>`
- small-domain distinct tuples do not collide
- `normalizeSignature` is idempotent
- `normalizeBody` is idempotent

Use `fast-check` only here. Example:

```tsx
fc.assert(
	fc.property(fc.string(), fc.string(), fc.string(), fc.string(), (repoId, path, kind, qname) => {
		const input = { repoId, relativePath: path, symbolKind: kind, qualifiedName: qname }
		expect(stableId(input)).toBe(stableId(input))
	}),
)
```

Add the `#field` pin:

```tsx
it("currently treats # as a comment marker even in TS private fields", () => {
	expect(normalizeBody("class A { #x = 1 }")).toBe("class A {")
})
```

#### A2. `packages/core/src/__tests__/schema.test.ts`

One file for schema boundaries. Groups: `PersistedMeta`, `Evidence`, `GraphNode`, `GraphEdge`, `VectorRow`, `BatchManifest`, `RigGraph`, `EmbedInput`, `EmbeddingResult`, `Candidate`, `ContextBundle`. Minimum cases per group: happy, invalid enum, invalid regex, invalid vector length, invalid evidence range.

#### A3. `packages/core/src/__tests__/edge-hash.test.ts`

- same edge identity → same hash
- different `src` → different hash
- different `type` → different hash
- different `dst` → different hash
- hash shape `cnt_<40 hex>`

### Phase B — Mock seam contracts

#### B1. `packages/parser/src/__tests__/mock-parser.test.ts`

Pin exact parser behavior:

- emits `File` node for every parsed file
- emits TS function declarations
- emits TS class declarations
- emits Python top-level `def`
- emits Python top-level class
- does not emit TS class methods
- does not emit arrow functions
- does not emit `export default` declarations unless intentionally supported
- all nodes validate as `GraphNode`
- all edges validate as `GraphEdge`
- `CONTAINS` edge `contentHash` follows edge hash rule

Fixture-specific golden test using `summarize()` that strips volatile metadata:

```tsx
const summarize = (r: ParseResult) => ({
	nodes: r.nodes.map((n) => ({
		kind: n.kind,
		qualifiedName: n.qualifiedName,
		signature: n.signature,
		evidence: n.evidence,
	})),
	edges: r.edges.map((e) => ({ src: e.src, type: e.type, dst: e.dst })),
})
```

#### B2. `packages/graph-store/src/__tests__/mock-graph-store.test.ts`

- `upsertNodes` is idempotent
- `upsertEdges` is idempotent by `src/type/dst`
- `getNode` returns inserted node
- `findByQualifiedName` exact match
- `findByQualifiedName` suffix match
- `findByQualifiedName` rejects `bargreet`
- `neighbors` depth 0
- `neighbors` `out` direction
- `neighbors` `in` direction
- `neighbors` `both` direction
- `neighbors` `edgeTypes` filter
- `neighbors` limit after BFS layer
- invalid node rejected
- invalid edge rejected

This is where Q7 and Q8 get pinned.

#### B3. `packages/vector-store/src/__tests__/mock-vector-store.test.ts`

- `upsert` inserts row
- same `nodeId` + `payloadKind` overwrites
- same `nodeId` + different `payloadKind` coexists
- `countByRun` counts current rows
- `search` sorts by cosine descending
- `search` respects limit
- zero vector score is 0
- invalid vector row rejected

#### B4. `packages/embedder/src/__tests__/mock-embedder.test.ts`

- `modelId` is `mock-embedder`
- `modelRevision` is `0`
- `dimension` is `EMBEDDING_DIM`
- result vector length is `EMBEDDING_DIM`
- values are finite
- values are within `[-1, 1]`
- same input gives same vector
- different text changes vector
- first 8 values snapshot
- `EmbeddingResult` schema accepts result

#### B5. `packages/reranker/src/__tests__/mock-reranker.test.ts`

- preserves candidate order
- sets `rerankScore = score`
- does not mutate input
- supports empty candidates

#### B6. `packages/rig/src/__tests__/mock-rig.test.ts`

- `canExtract` returns true
- `extract` returns `schemaVersion` 1
- `extract` returns root component
- `RigGraph` schema accepts output
- same input gives same output

#### B7. `packages/summarizer/src/__tests__/mock-summarizer.test.ts`

- returns `modelId`
- includes node count
- includes first qualified names
- same input gives same output

### Phase C — Retrieval contract

Add `packages/retrieval/src/__tests__/pipeline.test.ts`.

#### C1. Query embedding is always called

Use a recording embedder. Test `retrieve("greet")` calls embedder with `nodeId "__query__"` and `contentHash cnt_000...`.

#### C2. Exact lookup contributes candidates

Setup graph store with `src/greet.ts::greet` and `src/other.ts::greet`. Query `greet`. Expect two snippets, source path/lines retained, citations include paths.

#### C3. Semantic search contributes candidates

Setup vector store with one row and graph node. Expect semantic hit appears in snippets.

#### C4. Exact wins dedupe tie

If exact and semantic return same node: result appears once, candidate `source` remains `exact`. May need a `debug` mode on `RetrievalInput` or test indirectly through a recording reranker. Lower priority.

#### C5. Graph expansion is called *(important Phase 0 retrieval improvement)*

Test:

```
exact match A
A --CALLS--> B
retrieve("A")
→ B is included as graph candidate
```

This will fail on current code. Implement minimal expansion:

```tsx
const graphCandidates: Candidate[] = []
for (const c of [...exactCandidates, ...semanticCandidates]) {
	const expanded = await deps.graph.neighbors(c.nodeId, {
		depth: 1,
		direction: "both",
		limit: RETRIEVAL_LIMITS.graphExpandedHits,
	})
	for (const node of expanded.nodes) {
		if (node.id === c.nodeId) continue
		graphCandidates.push({
			nodeId: node.id,
			source: "graph",
			score: Math.max(0, c.score * 0.8),
			evidencePath: node.path,
			evidenceLines: [node.evidence.startLine, node.evidence.endLine],
		})
	}
}
```

Then merge `[...exactCandidates, ...semanticCandidates, ...graphCandidates]`.

#### C6. Reranker contract

Use a recording reranker. Assert: reranker receives max 60 candidates, final snippets respect limit, ranked order determines output.

#### C7. Context contract

Every snippet has `nodeId`, `path`, `lines`, `text` string. Citations format: `path:start-end`.

### Phase D — Indexer determinism and manifest contract

#### D1. `packages/indexer/src/__tests__/manifest.test.ts` (extend)

Add deterministic clock `const clock = { nowIso: () => "2026-01-01T00:00:00.000Z" }`. Tests:

- `pending → committed` stamps `committedAt` via clock
- `pending → failed` preserves `committedAt`
- `committed → failed` rejected
- `failed → committed` rejected
- same transition with same clock is byte-identical

#### D2. `packages/indexer/src/__tests__/smoke.test.ts` (split)

- smoke indexes fixture
- smoke calls RIG extractor
- smoke persists graph and vectors
- smoke creates committed manifest
- smoke idempotency by counts
- smoke deterministic snapshot with injected clock/idgen

With deterministic deps:

```tsx
const clock = { nowIso: () => "2026-01-01T00:00:00.000Z" }
const idGen = { batchId: () => "batch_test" }
```

Then compare complete result snapshots.

#### D3. Add `buildBatch(...)`

The biggest improvement to make the TDD plan cleaner. Right now `FixtureIndexer` mixes filesystem walking, parsing, RIG extraction, embedding, persistence, and manifest creation. Split a pure-ish batch builder:

```tsx
export type BuildBatchInput = {
	repoId: string
	indexRunId: string
	batchId: string
	files: ReadonlyArray<{
		path: string
		language: Language
		source: string
	}>
}

export type BuildBatchResult = {
	nodes: GraphNode[]
	edges: GraphEdge[]
	vectorInputs: EmbedInput[]
}
```

Tests cover `buildBatch(...)` without filesystem. `FixtureIndexer` remains the thin fs walker. This directly answers Q1: `FixtureIndexer` excluded from deterministic pure tests; `buildBatch` included; `retrieve` included.

### Phase E — CLI tests

Current CLI tests only check command registration. Keep them, then add behavior.

#### E1. Help test

`buildProgram().helpInformation()` includes `index`/`query`/`inspect`/`graph`. No subprocess needed.

#### E2. CLI index invokes indexer

Use a fake indexer dependency. Recommended change: `export const buildProgram = (deps: Phase0Deps = wirePhase0()): Command`. Then test the index command calls fake indexer with `repoPath`/`repoId`/`indexRunId`/`dryRun`.

#### E3. Query limit validation

Add CLI parser for positive integer:

- `query greet --limit abc` → rejects
- `query greet --limit 0` → rejects
- `query greet --limit 2` → accepted

#### E4. CLI dry-run smoke

Keep a subprocess smoke after build: `node dist/bin.js index ./fixtures/tiny-ts-lib --dry-run`. Do not rely only on this. The package-level test should own pipeline correctness.

---

## 📁 Recommended test file map

```
packages/core/src/__tests__/
  ids.test.ts
  schema.test.ts
  edge-hash.test.ts

packages/parser/src/__tests__/
  mock-parser.test.ts

packages/graph-store/src/__tests__/
  mock-graph-store.test.ts

packages/vector-store/src/__tests__/
  mock-vector-store.test.ts

packages/embedder/src/__tests__/
  mock-embedder.test.ts

packages/reranker/src/__tests__/
  mock-reranker.test.ts

packages/rig/src/__tests__/
  mock-rig.test.ts

packages/summarizer/src/__tests__/
  mock-summarizer.test.ts

packages/retrieval/src/__tests__/
  pipeline.test.ts

packages/indexer/src/__tests__/
  manifest.test.ts
  build-batch.test.ts
  smoke.test.ts

apps/cli/src/__tests__/
  cli.test.ts
  commands.test.ts
```

---

## 🛠️ Recommended implementation order

1. **Core test scaffolding** — add `packages/core/src/__tests__/builders.ts` with `makeMeta()`, `makeGraphNode()`, `makeGraphEdge()`, `makeVectorRow()`, `makeBatchManifest()`, `makeCandidate()`. Prevents schema-test boilerplate.
2. **Add `Clock` and `IdGen`** — before expanding smoke tests. Files: `packages/indexer/src/time.ts`, `packages/indexer/src/idgen.ts` (or keep in `indexer.ts`).
3. **Add edge hash helper** — `packages/core/src/ids.ts`, `packages/core/src/__tests__/edge-hash.test.ts`, then update `packages/parser/src/mock.ts`.
4. **Store validation tests** — failing tests for mock store validation, then update stores to parse DTOs.
5. **Parser golden tests** — decide Python method behavior (recommendation: file-scope only; methods land in Phase 1 tree-sitter) before writing the snapshot.
6. **Retrieval tests and graph expansion** — failing test for graph expansion, then update `retrieve()`. The most important CodeSoul-specific TDD step.
7. **Indexer deterministic tests** — inject clock/idgen, add deterministic snapshot test.
8. **CLI behavior tests** — refactor `buildProgram(deps = wirePhase0())`, test commands with fake deps.

---

## ✅ Final recommended decisions

| Question | Answer |
| --- | --- |
| Q1 | Include `retrieve()` |
| Q2 | Split strong/weak idempotency |
| Q3 | Inject `Clock` and `IdGen` |
| Q4 | Vitest + `fast-check` for core only |
| Q5 | Targeted Zod negatives |
| Q6 | Edge hash = `sha1(src,type,dst)` |
| Q7 | BFS layer-complete limit |
| Q8 | Keep suffix name matching |
| Q9 | Pin vector overwrite/coexist behavior |
| Q10 | Test deterministic 1024-dim vectors |
| Q11 | Golden-test exact parser scope |
| Q12 | Pin `#` stripping; fix later |
| Q13 | Always embed query in Phase 0 |

<aside>
⚠️

The one TDD item I would not postpone is **retrieval graph expansion**. Without that, Phase 0 proves a generic mock RAG skeleton, not CodeSoul's architecture-localization contract.

</aside>