# Codebase Alignment Review

I did not execute the repo locally, so this is a **static alignment review** against the uploaded code/status, not a test-run report.

# Next Steps

## Step 1 — Clean up roadmap and naming

**Goal:** remove phase drift and clarify current maturity.

Tasks:

```text
Rename wirePhase0 → wireRuntime
Rename Phase0Deps → RuntimeDeps
Update README status table
Create ROADMAP.md with capability gates
Keep backwards-compatible aliases temporarily
```

Acceptance:

```text
README no longer says Phase 5 is active if Phase 5/6/7 landed
All CLI flags map to IndexConfig
No tests refer to Phase0Deps except compatibility tests
```

---

## Step 2 — Make persistent local mode first-class

**Goal:** make `index → query` work across processes.

Tasks:

```text
Add --profile local-persist
Wire sqlite manifest store from CLI/env
Require Neo4j + LanceDB env for persistent profile
Add codesoul doctor
Add clear error when querying memory stores
```

Suggested commands:

```bash
codesoul doctor
codesoul index ./fixtures/tiny-ts-lib \
  --profile local-persist \
  --parser tree-sitter \
  --rig-extractors package-json

codesoul query "what calls greet" \
  --profile local-persist \
  --repo ./fixtures/tiny-ts-lib
```

Acceptance:

```text
Index in one process, query in another process returns non-empty snippets.
No silent fallback for graph/vector persistence.
```

---

## Step 3 — Implement real graph export

**Goal:** unblock graph determinism and inspection.

Tasks:

```text
Implement GraphStore.listNodes/listEdges-backed export
Support --repo-id and --index-run-id filters
Sort nodes/edges deterministically
Add JSON export tests for memory and Neo4j
Update nightly determinism to diff graph export
```

Acceptance:

```text
scripts/check-index-determinism.sh diffs exported graph JSON.
Graph export is no longer { nodes: [], edges: [] }.
```

---

## Step 4 — Add non-empty architecture query goldens

**Goal:** prove CodeSoul’s architecture-localization contract.

Tasks:

```text
Seed graph/vector stores in CLI test deps
Add golden tests for where-defined, calls, depends-on
Add query debug output or staged plan inspection
Lock ranked node IDs
```

Potential test fixture:

```text
tiny-ts-lib:
  greet
  greetMany -> greet
  farewell
  Farewell.message -> farewell
```

Acceptance:

```text
"what calls greet" returns greetMany via graph expansion.
"where is greet defined" returns src/greet.ts::greet.
"what depends on greet" returns callers/dependents, not only semantic matches.
```

---

## Step 5 — Block extraction in TreeSitterParser

**Goal:** handle long functions without flattening semantics.

Tasks:

```text
Add Block node extraction for TS/JS/Python
Gate by estimatedTokens > 512 or lineSpan > 60
Emit Function/Method -> Block CONTAINS edges
Add payloadKind: Block vector inputs
Add block ID convention
Add tests for if/for/while/try/switch/match/nested function/large group
```

Recommended ID convention:

```text
stableId(repoId, path, "Block", `${parentQualifiedName}#block:${ordinal}:${blockKind}`)
```

Do **not** include line numbers in block IDs.

Acceptance:

```text
Long function emits parent Function plus Block nodes.
Function content hash changes only for function-level changes.
Block content hash changes when block body changes.
Vector inputs include both FunctionSummary and Block payloads.
```

---

## Step 6 — Add fixture generator and scale gates

**Goal:** enforce the stated 500K–2M token target.

Tasks:

```text
Add scripts/generate-fixture.ts
Generate 100K–300K token fixture for PR or scheduled CI
Generate 500K–2M token fixture for nightly only
Track node/edge/vector counts
Track index latency and memory envelope
```

Acceptance:

```text
medium generated fixture indexes in CI.
large generated fixture indexes in nightly.
Nightly reports parser, graph, vector, and total indexing timings.
```

---

## Step 7 — Start minimal retrieval evals

**Goal:** move from “pipeline works” to “retrieval is measurable.”

Metrics:

| Metric              | First target |
| ------------------- | -----------: |
| Symbol Recall@10    |         ≥85% |
| File Recall@10      |         ≥90% |
| Architecture QA     |         ≥70% |
| Local p95 retrieval |          ≤2s |

Start with small deterministic eval cases before larger generated repos.

Initial eval set:

```text
symbol lookup
caller lookup
callee lookup
file import lookup
RIG component lookup
method lookup
block lookup
```

---

## Step 8 — Improve call/import resolution after eval failures

Only after the first evals show misses, improve resolution.

Likely next parser improvements:

```text
cross-file CALLS through local imports
barrel export resolution
extensionless TS import resolution
directory index resolution
type-only import handling
class method resolution across imported classes
Python from-import local module resolution
```

Do not implement all of these speculatively. Let evals drive priority.

---

## Step 9 — Stabilize model identity + real Qwen smoke path

The Python server already enforces concrete HF revision SHA and gates multi-GB real-load tests. Keep that.

Next:

```text
Add one documented “known-good” Qwen revision set
Add nightly optional real-model smoke
Record model latency
Record embedding throughput
Confirm LanceDB manifest identity refusal works with real Qwen embeddings
```

---

# 5. Suggested Immediate PR Sequence

## PR A — Runtime naming + roadmap cleanup

```text
wireRuntime aliases
README/ROADMAP update
status table update
```

## PR B — Persistent local profile

```text
--profile local-persist
sqlite manifest wiring
doctor command
memory query warning
```

## PR C — Graph export

```text
real JSON export
deterministic sort
nightly graph diff
```

## PR D — Non-empty query goldens

```text
seeded CLI deps
architecture query fixtures
ranked node ID assertions
```

## PR E — Block extraction

```text
TreeSitterParser blocks
Block vector inputs
block tests
```

## PR F — Fixture generator

```text
medium generated repo
large generated repo
nightly scale job
```

Then move into eval/tuning.

---

# 6. Updated Gate Definition

## Current state

You are roughly at:

```text
Gate C: real parser + durable manifest + graph/vector/model adapter seams
```

## Next gate

```text
Gate D: architecture retrieval quality
```

Gate D should require:

```text
real graph export
non-empty query goldens
block extraction
small retrieval eval harness
persistent index→query flow
```

## v1 gate

```text
Gate E: scale + acceptance
```

Gate E should require:

```text
100K–300K token fixture in CI
500K–2M token fixture in nightly
Recall@10 metrics
deterministic graph/vector export diff
local-persist profile documented
```

---

Prioritize:

1. persistent local profile,
2. graph export,
3. non-empty architecture query goldens,
4. block extraction,
5. generated scale fixtures,
6. retrieval eval harness.
