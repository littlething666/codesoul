<aside>
📌

**Goal:** Land a compiling, end-to-end skeleton with every architectural seam expressed as an interface and backed by deterministic mocks. **No external services**, no native parsers, no Neo4j, no LanceDB, no model server. Local fixture filesystem reads are allowed only in the CLI / test harness. Exit when the full pipeline runs against `fixtures/tiny-ts-lib` using mocks only.

</aside>

## 🎯 Scope

Phase 0 delivers:

1. `packages/core` — DTOs (Zod), ID/normalization helpers, manifest types, error types, schema constants, shared `PersistedMeta`.
2. Seam interfaces — `Parser`, `RigExtractor`, `GraphStore`, `VectorStore`, `Embedder`, `Reranker`, `Summarizer`, `Indexer`.
3. Mock implementations of every seam (in-memory, deterministic).
4. `packages/indexer` — the index-pipeline state machine that composes the seams.
5. `apps/cli` skeleton on **Commander v14.0.3**, with the workspace still ESM-only by policy. Provides `index`, `query`, `inspect`, `graph export` commands wired to the `Indexer` and other seams.
6. End-to-end smoke test on `fixtures/tiny-ts-lib` running through every seam via mocks, plus a CLI-level wiring test.
7. ESM-only workspace baseline (`"type": "module"` everywhere, NodeNext module resolution).

Phase 0 explicitly does **not** deliver:

- tree-sitter parsing
- Neo4j adapter
- LanceDB adapter
- FastAPI model server
- Qwen3 embeddings
- retrieval ranking quality
- golden-query tests on real repos
- real `PackageJsonRigExtractor`
- real `PyProjectRigExtractor`
- real repository file discovery beyond the fixture harness

Those land in Phase 1+.

## 🧭 Out-of-scope guardrails

<aside>
⚠️

- No package may import from `apps/*`.
- No seam implementation may leak vendor types (no `Driver` from `neo4j-driver`, no `Connection` from `@lancedb/lancedb`) above the adapter boundary.
- No hardcoded model runtime. `MockEmbedder` and `MockReranker` satisfy the same interface real backends will.
- All DTOs are Zod-validated at every boundary. No `as` casts above adapters.
- Every persisted record carries `repoId`, `indexRunId`, `batchId`, `contentHash`, `schemaVersion` (DTO-side, camelCase). Persistence adapters may translate these into snake_case database columns, but all TypeScript DTOs use camelCase. The mocks enforce the camelCase shape.
- All package subpath imports must be explicitly declared in `package.json` `"exports"`. Test-only mock imports use the `"./mock"` subpath export, never deep `src/` imports.
</aside>

## 🟢 ESM-only workspace baseline

The monorepo is ESM-only **by CodeSoul policy**, not because Commander forces it. Commander v14.0.3 is the Phase 0 stable CLI dependency; Commander v15 is currently a pre-release ESM-only migration candidate that we'll re-evaluate once a stable non-prerelease ships.

### Root `package.json`

```json
{
  "name": "codesoul",
  "private": true,
  "type": "module",
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

`@types/node@24.12.2` matches the Node 24 engine target. Do not bump to `@types/node@25.x` while the engine range excludes Node 25.

### Per-package `package.json` template (libraries that expose a mock)

```json
{
  "name": "@codesoul/<pkg>",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./mock": {
      "types": "./dist/mock.d.ts",
      "import": "./dist/mock.js"
    }
  },
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Libraries without a mock omit the `"./mock"` export entry and the `src/mock.ts` tsup entry.

### `tsconfig.base.json`

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "lib": ["ES2023"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "esModuleInterop": false
  }
}
```

### `tsup.config.ts` (libraries that expose a mock)

```tsx
import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts", "src/mock.ts"],
	format: ["esm"],
	target: "node22",
	dts: true,
	sourcemap: true,
	clean: true,
})
```

Libraries without a mock use `entry: ["src/index.ts"]` only. Apps (`apps/cli`) have their own tsup config (see CLI section) — the library template is not reused blindly for apps.

ESM rules every contributor must follow:

- All relative imports include the `.js` extension (e.g. `import { stableId } from "./ids.js"`). Required by NodeNext.
- No `require(...)` anywhere. No `__dirname` / `__filename`; use `import.meta.url` + `fileURLToPath`.
- No `default` re-exports across package boundaries — named exports only.
- App packages may have app-specific tsup entrypoints; library package templates are not reused blindly for apps.

## 📦 Package layout for Phase 0

```
packages/
  core/
    src/
      ids.ts                 # stableId, contentId, normalizeSignature, normalizeBody
      schema/
        meta.ts              # PersistedMeta (shared metadata schema)
        node.ts              # GraphNode, NodeKind, Evidence, Language
        edge.ts              # GraphEdge, EdgeType
        vector.ts            # VectorRow
        rig.ts               # RigGraph, RigComponent, RigTarget, RigTest
        manifest.ts          # IngestionManifest, BatchManifest, BatchStatus
        retrieval.ts         # Candidate, RankedCandidate, ContextBundle
        embed.ts             # EmbedInput, EmbeddingResult
        index.ts
      errors.ts              # CodeSoulError + subclasses
      constants.ts           # SCHEMA_VERSION, EMBEDDING_DIM, candidate caps
      index.ts
  parser/
    src/
      parser.ts              # interface Parser
      mock.ts                # MockParser (regex-based, deterministic, in-memory)
      index.ts
  rig/
    src/
      extractor.ts           # interface RigExtractor
      mock.ts                # MockRigExtractor (static in-memory RigGraph)
      index.ts
  graph-store/
    src/
      store.ts               # interface GraphStore + TraversalOptions
      mock.ts                # MockGraphStore (in-memory)
      index.ts
  vector-store/
    src/
      store.ts               # interface VectorStore
      mock.ts                # MockVectorStore (Map<string, VectorRow>, brute-force cosine)
      index.ts
  embedder/
    src/
      embedder.ts            # interface Embedder
      mock.ts                # MockEmbedder (per-slot deterministic floats)
      index.ts
  reranker/
    src/
      reranker.ts            # interface Reranker
      mock.ts                # MockReranker (passthrough)
      index.ts
  summarizer/
    src/
      summarizer.ts          # interface Summarizer
      mock.ts                # MockSummarizer ("<community N nodes>")
      index.ts
  retrieval/
    src/
      pipeline.ts            # parseQuery → exact → vector → expand → merge → rerank → assemble (skeleton)
      index.ts
  indexer/
    src/
      indexer.ts             # Indexer interface + indexRepository implementation
      mock-fixture.ts        # Phase 0 fixture driver (walks a fixture path)
      manifest.ts            # batch state transition helpers
      index.ts
apps/
  cli/
    src/
      bin.ts                 # #!/usr/bin/env node entrypoint
      program.ts             # Commander v14 setup
      commands/
        index.ts
        query.ts
        inspect.ts
        graph-export.ts
      wiring.ts              # composes mock seams + Indexer for Phase 0
```

## 🧬 `packages/core` — DTOs and helpers

### `constants.ts`

```tsx
export const SCHEMA_VERSION = 1 as const
export const EMBEDDING_DIM = 1024 as const

export const RETRIEVAL_LIMITS = {
	exactSymbolHits: 20,
	semanticHits: 30,
	graphExpandedHits: 30,
	rerankInput: 60,
	finalSnippets: 10,
} as const

export const CONTEXT_BUDGET_TOKENS = {
	total: 8_000,
	system: 1_000,
	architecture: 1_000,
	snippets: 5_500,
	citations: 500,
} as const
```

### `ids.ts`

```tsx
import { createHash } from "node:crypto"

export type StableIdInput = {
	repoId: string
	relativePath: string
	symbolKind: string
	qualifiedName: string
}

export type ContentIdInput = {
	normalizedSignature: string
	normalizedBody: string
}

const sha1 = (parts: readonly string[]): string => {
	const h = createHash("sha1")
	for (const p of parts) {
		h.update(p)
		h.update("\u0000")
	}
	return h.digest("hex")
}

export const stableId = (input: StableIdInput): string =>
	`sym_${sha1([input.repoId, input.relativePath, input.symbolKind, input.qualifiedName])}`

export const contentId = (input: ContentIdInput): string =>
	`cnt_${sha1([input.normalizedSignature, input.normalizedBody])}`

// Whitespace + comment normalization. Line numbers MUST NOT participate in IDs.
export const normalizeSignature = (raw: string): string =>
	raw.replace(/\s+/g, " ").trim()

export const normalizeBody = (raw: string): string =>
	raw
		.replace(/\/\/.*$/gm, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/#.*$/gm, "")
		.replace(/\s+/g, " ")
		.trim()
```

### `schema/meta.ts` — shared persisted metadata

```tsx
import { z } from "zod"

export const PersistedMeta = z.object({
	repoId: z.string().min(1),
	indexRunId: z.string().min(1),
	batchId: z.string().min(1),
	sourcePath: z.string().min(1),
	contentHash: z.string().regex(/^cnt_[0-9a-f]{40}$/),
	schemaVersion: z.literal(1),
})
export type PersistedMeta = z.infer<typeof PersistedMeta>
```

Every node, edge, and vector DTO composes `PersistedMeta`. `BatchManifest` defines the same fields explicitly because it is the manifest of a batch, not an item inside one.

### `schema/node.ts`

```tsx
import { z } from "zod"
import { PersistedMeta } from "./meta.js"

export const NodeKind = z.enum([
	"File",
	"Module",
	"Class",
	"Function",
	"Method",
	"Import",
	"Block",
	"RigComponent",
	"RigTarget",
	"RigTest",
])
export type NodeKind = z.infer<typeof NodeKind>

export const Language = z.enum(["typescript", "javascript", "python", "markdown", "unknown"])
export type Language = z.infer<typeof Language>

export const Evidence = z
	.object({
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.refine((v) => v.endLine >= v.startLine, {
		message: "endLine must be >= startLine",
	})
export type Evidence = z.infer<typeof Evidence>

export const GraphNode = PersistedMeta.extend({
	id: z.string().regex(/^sym_[0-9a-f]{40}$/),
	path: z.string().min(1),
	kind: NodeKind,
	language: Language,
	qualifiedName: z.string().min(1),
	signature: z.string(),
	evidence: Evidence,
})
export type GraphNode = z.infer<typeof GraphNode>
```

### `schema/edge.ts`

```tsx
import { z } from "zod"
import { PersistedMeta } from "./meta.js"

export const EdgeType = z.enum([
	"CONTAINS",
	"CALLS",
	"IMPORTS",
	"IMPLEMENTS",
	"EXTENDS",
	"DEFINED_IN",
	"DEPENDS_ON",
	"DECLARED_BY",
])
export type EdgeType = z.infer<typeof EdgeType>

export const GraphEdge = PersistedMeta.extend({
	src: z.string().regex(/^sym_[0-9a-f]{40}$/),
	dst: z.string().regex(/^sym_[0-9a-f]{40}$/),
	type: EdgeType,
	// Optional, edge-type-specific metadata (e.g. CALLS site evidence).
	attributes: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
		.optional(),
})
export type GraphEdge = z.infer<typeof GraphEdge>
```

### `schema/vector.ts`

```tsx
import { z } from "zod"
import { EMBEDDING_DIM } from "../constants.js"
import { PersistedMeta } from "./meta.js"

export const VectorRow = PersistedMeta.extend({
	nodeId: z.string().regex(/^sym_[0-9a-f]{40}$/),
	embeddingModel: z.string(),
	embeddingRevision: z.string(),
	embeddingDim: z.literal(EMBEDDING_DIM),
	vector: z.array(z.number().finite()).length(EMBEDDING_DIM),
	payloadKind: z.enum(["FunctionSummary", "Block", "Markdown"]),
})
export type VectorRow = z.infer<typeof VectorRow>
```

### `schema/manifest.ts`

```tsx
import { z } from "zod"

export const BatchStatus = z.enum(["pending", "committed", "failed"])
export type BatchStatus = z.infer<typeof BatchStatus>

export const BatchManifest = z.object({
	batchId: z.string(),
	indexRunId: z.string(),
	repoId: z.string(),
	sourcePath: z.string(),
	sourceContentHash: z.string().regex(/^cnt_[0-9a-f]{40}$/),
	status: BatchStatus,
	nodeCount: z.number().int().nonnegative(),
	edgeCount: z.number().int().nonnegative(),
	vectorCount: z.number().int().nonnegative(),
	createdAt: z.string().datetime(),
	committedAt: z.string().datetime().nullable(),
	checksum: z.string(),
	schemaVersion: z.literal(1),
})
export type BatchManifest = z.infer<typeof BatchManifest>

export const IngestionManifest = z.object({
	indexRunId: z.string(),
	repoId: z.string(),
	startedAt: z.string().datetime(),
	finishedAt: z.string().datetime().nullable(),
	embeddingModel: z.string(),
	embeddingRevision: z.string(),
	embeddingDim: z.number().int(),
	rerankerModel: z.string().nullable(),
	rerankerRevision: z.string().nullable(),
	tokenizerVersion: z.string(),
	schemaVersion: z.literal(1),
})
export type IngestionManifest = z.infer<typeof IngestionManifest>
```

### `schema/rig.ts`

```tsx
import { z } from "zod"

export const RigComponent = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.enum(["package", "workspace", "app", "library", "binary"]),
	path: z.string(),
	dependsOn: z.array(z.string()),
})

export const RigTarget = z.object({
	id: z.string(),
	componentId: z.string(),
	name: z.string(),
	kind: z.enum(["build", "run", "publish"]),
})

export const RigTest = z.object({
	id: z.string(),
	componentId: z.string(),
	name: z.string(),
	framework: z.string().nullable(),
})

export const RigGraph = z.object({
	extractor: z.string(),
	extractorVersion: z.string(),
	components: z.array(RigComponent),
	targets: z.array(RigTarget),
	tests: z.array(RigTest),
	schemaVersion: z.literal(1),
})
export type RigGraph = z.infer<typeof RigGraph>
```

### `schema/embed.ts` and `schema/retrieval.ts`

```tsx
// embed.ts
import { z } from "zod"
import { EMBEDDING_DIM } from "../constants.js"

export const EmbedInput = z.object({
	nodeId: z.string(),
	contentHash: z.string(),
	payloadKind: z.enum(["FunctionSummary", "Block", "Markdown"]),
	text: z.string(),
})
export type EmbedInput = z.infer<typeof EmbedInput>

export const EmbeddingResult = z.object({
	nodeId: z.string(),
	vector: z.array(z.number().finite()).length(EMBEDDING_DIM),
	embeddingModel: z.string(),
	embeddingRevision: z.string(),
	embeddingDim: z.literal(EMBEDDING_DIM),
})
export type EmbeddingResult = z.infer<typeof EmbeddingResult>
```

```tsx
// retrieval.ts
import { z } from "zod"

export const Candidate = z.object({
	nodeId: z.string(),
	source: z.enum(["exact", "semantic", "graph"]),
	score: z.number(),
	evidencePath: z.string(),
	evidenceLines: z.tuple([z.number().int(), z.number().int()]),
})
export type Candidate = z.infer<typeof Candidate>

export const RankedCandidate = Candidate.extend({
	rerankScore: z.number(),
})
export type RankedCandidate = z.infer<typeof RankedCandidate>

export const ContextBundle = z.object({
	query: z.string(),
	snippets: z.array(
		z.object({
			nodeId: z.string(),
			path: z.string(),
			lines: z.tuple([z.number().int(), z.number().int()]),
			text: z.string(),
		}),
	),
	citations: z.array(z.string()),
	tokenBudget: z.object({
		total: z.number().int(),
		used: z.number().int(),
	}),
})
export type ContextBundle = z.infer<typeof ContextBundle>
```

### `errors.ts`

```tsx
export class CodeSoulError extends Error {
	constructor(message: string, readonly cause?: unknown) {
		super(message)
		this.name = new.target.name
	}
}

export class SchemaValidationError extends CodeSoulError {}
export class ManifestStateError extends CodeSoulError {}
export class AdapterUnavailableError extends CodeSoulError {}
export class RigExtractionError extends CodeSoulError {}
```

## 🔌 Seam interfaces

### `parser`

```tsx
import type { GraphEdge, GraphNode, Language } from "@codesoul/core"

export type ParseResult = {
	nodes: GraphNode[]
	edges: GraphEdge[]
}

export interface Parser {
	readonly languages: ReadonlyArray<Language>
	parseFile(args: {
		repoId: string
		indexRunId: string
		batchId: string
		path: string
		language: Language
		source: string
	}): Promise<ParseResult>
}
```

### `rig`

```tsx
import type { RigGraph } from "@codesoul/core"

export interface RigExtractor {
	readonly name: string
	canExtract(repoPath: string): Promise<boolean>
	extract(repoPath: string): Promise<RigGraph>
}
```

### `graph-store`

```tsx
import type { GraphEdge, GraphNode, EdgeType } from "@codesoul/core"

export type TraversalOptions = {
	depth: number
	edgeTypes?: ReadonlyArray<EdgeType>
	direction?: "out" | "in" | "both"
	limit?: number
}

export type GraphQueryResult = {
	nodes: GraphNode[]
	edges: GraphEdge[]
}

export interface GraphStore {
	upsertNodes(nodes: ReadonlyArray<GraphNode>): Promise<void>
	upsertEdges(edges: ReadonlyArray<GraphEdge>): Promise<void>
	getNode(id: string): Promise<GraphNode | null>
	neighbors(id: string, options: TraversalOptions): Promise<GraphQueryResult>
	findByQualifiedName(name: string): Promise<GraphNode[]>
	health(): Promise<{ ok: boolean; details?: string }>
}
```

### `vector-store`

```tsx
import type { VectorRow } from "@codesoul/core"

export type VectorSearchHit = {
	nodeId: string
	score: number
	payloadKind: VectorRow["payloadKind"]
}

export interface VectorStore {
	upsert(rows: ReadonlyArray<VectorRow>): Promise<void>
	search(query: { vector: number[]; limit: number }): Promise<VectorSearchHit[]>
	countByRun(indexRunId: string): Promise<number>
	health(): Promise<{ ok: boolean; details?: string }>
}
```

### `embedder`

```tsx
import type { EmbedInput, EmbeddingResult } from "@codesoul/core"

export interface Embedder {
	readonly modelId: string
	readonly modelRevision: string
	readonly dimension: number
	embed(inputs: ReadonlyArray<EmbedInput>): Promise<EmbeddingResult[]>
}
```

### `reranker`

```tsx
import type { Candidate, RankedCandidate } from "@codesoul/core"

export type RerankOptions = {
	timeoutMs?: number
}

export interface Reranker {
	readonly modelId: string
	readonly modelRevision: string
	rerank(
		query: string,
		candidates: ReadonlyArray<Candidate>,
		options?: RerankOptions,
	): Promise<RankedCandidate[]>
}
```

### `summarizer`

```tsx
export type CommunitySummaryInput = {
	communityId: string
	nodeIds: ReadonlyArray<string>
	signals: { qualifiedNames: string[]; paths: string[] }
}

export type CommunitySummary = {
	communityId: string
	title: string
	description: string
	modelId: string
}

export interface Summarizer {
	readonly modelId: string
	summarizeCommunity(input: CommunitySummaryInput): Promise<CommunitySummary>
}
```

### `indexer` — Phase 0 home of the index pipeline

The CLI must not own pipeline orchestration. The `Indexer` seam composes `Parser`, `RigExtractor`, `GraphStore`, `VectorStore`, and `Embedder` and is the only consumer the CLI talks to for indexing.

```tsx
import type { Embedder } from "@codesoul/embedder"
import type { GraphStore } from "@codesoul/graph-store"
import type { Parser } from "@codesoul/parser"
import type { RigExtractor } from "@codesoul/rig"
import type { VectorStore } from "@codesoul/vector-store"
import type { BatchManifest } from "@codesoul/core"

export type IndexRepositoryInput = {
	repoPath: string
	repoId: string
	indexRunId: string
	dryRun?: boolean
}

export type IndexRepositoryResult = {
	manifest: BatchManifest
	nodeCount: number
	edgeCount: number
	vectorCount: number
}

export type IndexerDeps = {
	parser: Parser
	rig: RigExtractor
	graph: GraphStore
	vectors: VectorStore
	embedder: Embedder
}

export interface Indexer {
	indexRepository(input: IndexRepositoryInput): Promise<IndexRepositoryResult>
}
```

Phase 0 ships a concrete `FixtureIndexer` (in `mock-fixture.ts`) that walks `repoPath` from the local filesystem, but only as a test/CLI harness driver. Any production-grade discovery (gitignore, submodules, monorepo roots) lands in Phase 1+.

## 🧪 Mocks (deterministic)

- `MockParser` — regex-based extraction of `function`/`class`/`def` declarations on TS/JS/Python source strings. Emits `Function` and `Class` nodes plus `CONTAINS` edges. Pure: takes `source` as a string, performs no I/O. Deterministic line numbers from source offsets.
- `MockGraphStore` — `Map<string, GraphNode>` keyed by `id`, plus `Map<string, GraphEdge>` keyed by `${src}|${type}|${dst}`. Idempotent upserts. `neighbors` is BFS up to `depth`.
- `MockVectorStore` — `Map<string, VectorRow>` keyed by `${nodeId}:${payloadKind}`. Idempotent upserts. `search` is brute-force cosine over the values.
- `MockEmbedder` — `modelId: "mock-embedder"`, `modelRevision: "0"`, `dimension: 1024`. Each of the 1024 slots is an independent deterministic float in `[-1, 1]`, derived per slot:

    ```tsx
    const valueAt = (text: string, i: number): number => {
    	const h = createHash("sha256")
    		.update(text)
    		.update("\u0000")
    		.update(String(i))
    		.digest()
    	const n = h.readUInt32BE(0)
    	return (n / 0xffffffff) * 2 - 1
    }
    ```

    Pure, deterministic, no I/O, no slot collisions.

- `MockReranker` — passthrough; assigns `rerankScore = candidate.score`. `modelId: "mock-reranker"`, `modelRevision: "0"`.
- `MockSummarizer` — returns `"<community of N nodes: foo, bar, …>"`.
- `MockRigExtractor` — deterministic in-memory extractor used by tests. Returns a static `RigGraph` with a fixed component/target/test set; performs no filesystem reads. The real `PackageJsonRigExtractor` and `PyProjectRigExtractor` belong to Phase 1.

Every mock is constructed without arguments and is referentially transparent given the same inputs. They live next to the interfaces (`packages/<seam>/src/mock.ts`) and are imported through the package's `"./mock"` subpath export.

## 🖥️ CLI skeleton — Commander v14.0.3 (ESM-only by policy)

### Why v14.0.3

The workspace is ESM-only by CodeSoul policy. Commander v14.0.3 remains the stable, non-prerelease CLI dependency for Phase 0. Commander v15 is a pre-release ESM-only migration candidate; re-evaluate it once a stable non-prerelease is published.

### `apps/cli/package.json`

```json
{
  "name": "@codesoul/cli",
  "private": true,
  "type": "module",
  "bin": {
    "codesoul": "./dist/bin.js"
  },
  "scripts": {
    "build": "tsup",
    "dev": "tsx src/bin.ts",
    "start": "node dist/bin.js",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@codesoul/core": "workspace:*",
    "@codesoul/embedder": "workspace:*",
    "@codesoul/graph-store": "workspace:*",
    "@codesoul/indexer": "workspace:*",
    "@codesoul/parser": "workspace:*",
    "@codesoul/reranker": "workspace:*",
    "@codesoul/retrieval": "workspace:*",
    "@codesoul/rig": "workspace:*",
    "@codesoul/vector-store": "workspace:*",
    "commander": "14.0.3",
    "pino": "10.3.1",
    "zod": "4.4.2"
  }
}
```

`undici` is intentionally absent in Phase 0 — add it only when HTTP backends land. The parent doc's pinned-versions table keeps `commander: 14.0.3` (no change).

### `apps/cli/tsup.config.ts`

Apps need a different entrypoint and shape than libraries:

```tsx
import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/bin.ts"],
	format: ["esm"],
	target: "node22",
	dts: false,
	sourcemap: true,
	clean: true,
	banner: {
		js: "#!/usr/bin/env node",
	},
})
```

### `apps/cli/src/bin.ts`

```tsx
import { run } from "./program.js"

await run(process.argv)
```

The `#!/usr/bin/env node` shebang is injected by the tsup banner above.

### `apps/cli/src/program.ts`

```tsx
import { Command } from "commander"
import { registerIndex } from "./commands/index.js"
import { registerQuery } from "./commands/query.js"
import { registerInspect } from "./commands/inspect.js"
import { registerGraphExport } from "./commands/graph-export.js"
import { wirePhase0 } from "./wiring.js"

export const buildProgram = (): Command => {
	const program = new Command()
		.name("codesoul")
		.description("CodeSoul: repository architecture extraction layer")
		.version("0.0.0")
		.showHelpAfterError()
		.enablePositionalOptions()

	const deps = wirePhase0()
	registerIndex(program, deps)
	registerQuery(program, deps)
	registerInspect(program, deps)
	registerGraphExport(program, deps)

	return program
}

export const run = async (argv: readonly string[]): Promise<void> => {
	const program = buildProgram()
	await program.parseAsync([...argv], { from: "node" })
}
```

No `as` cast — `parseAsync` accepts `string[]`, and `[...argv]` produces a fresh mutable copy from the `readonly string[]` input.

### `apps/cli/src/wiring.ts`

```tsx
import { MockEmbedder } from "@codesoul/embedder/mock"
import { MockGraphStore } from "@codesoul/graph-store/mock"
import { MockParser } from "@codesoul/parser/mock"
import { MockReranker } from "@codesoul/reranker/mock"
import { MockRigExtractor } from "@codesoul/rig/mock"
import { MockVectorStore } from "@codesoul/vector-store/mock"
import { FixtureIndexer } from "@codesoul/indexer"
import type { Indexer } from "@codesoul/indexer"

export type Phase0Deps = {
	parser: MockParser
	rig: MockRigExtractor
	graph: MockGraphStore
	vectors: MockVectorStore
	embedder: MockEmbedder
	reranker: MockReranker
	indexer: Indexer
}

export const wirePhase0 = (): Phase0Deps => {
	const parser = new MockParser()
	const rig = new MockRigExtractor()
	const graph = new MockGraphStore()
	const vectors = new MockVectorStore()
	const embedder = new MockEmbedder()
	const reranker = new MockReranker()
	const indexer = new FixtureIndexer({ parser, rig, graph, vectors, embedder })
	return { parser, rig, graph, vectors, embedder, reranker, indexer }
}
```

### `apps/cli/src/commands/index.ts`

```tsx
import type { Command } from "commander"
import type { Phase0Deps } from "../wiring.js"

export const registerIndex = (program: Command, deps: Phase0Deps): void => {
	program
		.command("index")
		.description("Index a repository (Phase 0: mocks only)")
		.argument("<repoPath>", "path to the repository")
		.option("--repo-id <id>", "explicit repo id")
		.option("--dry-run", "parse and validate without persisting", false)
		.action(
			async (
				repoPath: string,
				opts: { repoId?: string; dryRun: boolean },
			) => {
				const result = await deps.indexer.indexRepository({
					repoPath,
					repoId: opts.repoId ?? "repo_fixture",
					indexRunId: "run_phase0",
					dryRun: opts.dryRun,
				})

				console.log(
					JSON.stringify(
						{
							status: result.manifest.status,
							nodes: result.nodeCount,
							edges: result.edgeCount,
							vectors: result.vectorCount,
						},
						null,
						2,
					),
				)
			},
		)
}
```

Other commands follow the same pattern: `query <text>`, `inspect nodes|edges|vectors|query`, `graph export --format graphml|json`. Each is a thin adapter over the seam interfaces. **No business logic in `apps/cli/*` beyond argument parsing and pretty-printing** — pipeline logic lives in `@codesoul/indexer` and the seam packages.

## 🔁 End-to-end smoke tests (Phase 0 exit gate)

Two layers:

### Package-level smoke test (`packages/indexer/src/__tests__/smoke.test.ts`)

Runs the full mock pipeline against `fixtures/tiny-ts-lib` (~5K LOC):

1. `wirePhase0()` → mocks + `FixtureIndexer`.
2. `indexer.indexRepository({ repoPath, repoId, indexRunId })` walks the fixture, runs `MockParser.parseFile` per file, calls `MockRigExtractor.extract`, builds nodes/edges, embeds via `MockEmbedder`, upserts into `MockGraphStore` and `MockVectorStore`, transitions a `BatchManifest` `pending → committed`.
3. Assert: `graph.findByQualifiedName("foo")` returns the expected node; `vectors.countByRun(indexRunId)` equals the function count; `manifest.status === "committed"`.
4. Run `indexRepository` twice with the same inputs and assert idempotency (node/edge/vector counts unchanged after the second run).

### CLI-level wiring test (`apps/cli/src/__tests__/cli.test.ts`)

Proves the bin actually wires up:

```tsx
import { execaNode } from "execa"
import { describe, expect, it } from "vitest"

describe("codesoul CLI", () => {
	it("index --dry-run exits 0", async () => {
		const result = await execaNode("dist/bin.js", [
			"index",
			"../../fixtures/tiny-ts-lib",
			"--dry-run",
		])
		expect(result.exitCode).toBe(0)
		expect(result.stdout).toContain("\"status\"")
	})
})
```

The package-level test owns detailed graph/vector assertions; the CLI-level test only proves wiring.

## ✅ Exit criteria

<aside>
✅

- `pnpm -r build`, `pnpm -r typecheck`, and `pnpm -r test` are green.
- `pnpm --filter @codesoul/cli exec node dist/bin.js --help` prints help.
- `pnpm --filter @codesoul/cli exec node dist/bin.js index ./fixtures/tiny-ts-lib --dry-run` exits 0.
- The package-level smoke test runs the full mock pipeline: parser → RIG → graph → embedder → vector store → manifest.
- Running the smoke pipeline twice is idempotent.
- Every package is ESM-only and every public subpath import is declared in `"exports"` (including `"./mock"` for packages that ship a mock).
- No `require`, no `__dirname`, no CJS interop shim anywhere in the repo.
- DTOs use camelCase; adapters may translate to backend-specific naming.
- Every persisted DTO is Zod-validated at the seam boundary, with `repoId`, `indexRunId`, `batchId`, `contentHash`, `schemaVersion` carried via `PersistedMeta`.
</aside>

## ➡️ Hand-off to Phase 1

Phase 1 picks up by:

- Replacing `MockParser` with the real `tree-sitter@0.25.0` adapter.
- TDD'ing `stableId`/`contentId` invariants (already implemented; tests formalize them).
- Implementing `PackageJsonRigExtractor` and `PyProjectRigExtractor` against fixtures.
- Implementing the `BatchManifest` WAL state machine with `better-sqlite3@12.9.0`.
- Hardening `FixtureIndexer` into the production `Indexer` (gitignore, submodules, parallel walks).

Nothing in Phase 1 should require changes to interfaces, `PersistedMeta`, or DTOs. If it does, that is a Phase 0 gap — fix Phase 0 first.
