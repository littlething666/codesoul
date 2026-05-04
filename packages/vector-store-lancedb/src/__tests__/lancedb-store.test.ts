import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	EMBEDDING_DIM,
	EmbeddingCompatibilityError,
	type VectorRow,
} from "@codesoul/core"
import { LanceDBVectorStore } from "../lancedb-store.js"

// Integration tests run only when an explicit env var is set, because
// they require the @lancedb/lancedb native binary and write to a temp
// directory. Without it the suite skips silently so `pnpm -r test` stays
// green on dev machines and PR CI without LanceDB wired in.
//
// To run locally:
//   LANCEDB_INTEGRATION=1 pnpm --filter @codesoul/vector-store-lancedb test
const RUN = process.env.LANCEDB_INTEGRATION === "1"
const describeIntegration = RUN ? describe : describe.skip

const SYM = (c: string) => `sym_${c.repeat(40)}`
const CNT = (c: string) => `cnt_${c.repeat(40)}`

const meta = {
	repoId: "r",
	indexRunId: "run_t",
	batchId: "batch_t",
	sourcePath: "src/x.ts",
	contentHash: CNT("a"),
	schemaVersion: 1 as const,
}

const makeVector = (seed: number): number[] => {
	const out = new Array<number>(EMBEDDING_DIM)
	for (let i = 0; i < EMBEDDING_DIM; i++) {
		out[i] = Math.sin(seed * (i + 1))
	}
	return out
}

const row = (
	nodeId: string,
	overrides: Partial<VectorRow> = {},
): VectorRow => ({
	...meta,
	nodeId,
	embeddingModel: "Qwen/Qwen3-Embedding-0.6B",
	embeddingRevision: "abc",
	embeddingDim: EMBEDDING_DIM,
	vector: makeVector(nodeId.charCodeAt(4)),
	payloadKind: "FunctionSummary",
	...overrides,
})

describeIntegration("LanceDBVectorStore (integration)", () => {
	let dir: string
	let store: LanceDBVectorStore

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "codesoul-lancedb-"))
		store = new LanceDBVectorStore({ uri: dir })
	})

	afterEach(async () => {
		await store.close()
		await rm(dir, { recursive: true, force: true })
	})

	it("upserts rows and counts by run", async () => {
		await store.upsert([row(SYM("a")), row(SYM("b"))])
		expect(await store.countByRun("run_t")).toBe(2)
	})

	it("upsert is idempotent on (nodeId, payloadKind)", async () => {
		await store.upsert([row(SYM("a"))])
		await store.upsert([row(SYM("a"))])
		expect(await store.countByRun("run_t")).toBe(1)
	})

	it("same nodeId + different payloadKind coexist", async () => {
		await store.upsert([row(SYM("a"))])
		await store.upsert([row(SYM("a"), { payloadKind: "Block" })])
		expect(await store.countByRun("run_t")).toBe(2)
	})

	it("search returns up to limit hits, sorted descending by score", async () => {
		const a = row(SYM("a"))
		const b = row(SYM("b"))
		await store.upsert([a, b])
		const hits = await store.search({ vector: a.vector, limit: 1 })
		expect(hits.length).toBe(1)
		expect(hits[0]?.nodeId).toBe(SYM("a"))
	})

	it("upsert refuses rows whose embedding identity differs from the table's", async () => {
		await store.upsert([row(SYM("a"))])
		await expect(
			store.upsert([
				row(SYM("b"), { embeddingRevision: "different" }),
			]),
		).rejects.toBeInstanceOf(EmbeddingCompatibilityError)
	})

	it("upsert refuses rows whose embeddingModel differs", async () => {
		await store.upsert([row(SYM("a"))])
		await expect(
			store.upsert([
				row(SYM("b"), { embeddingModel: "some/other-model" }),
			]),
		).rejects.toBeInstanceOf(EmbeddingCompatibilityError)
	})

	it("search refuses a query whose vector length differs from the table's embeddingDim", async () => {
		await store.upsert([row(SYM("a"))])
		await expect(
			store.search({ vector: [1, 2, 3], limit: 1 }),
		).rejects.toBeInstanceOf(EmbeddingCompatibilityError)
	})

	it("listByRun returns rows for the run only", async () => {
		await store.upsert([
			row(SYM("a")),
			row(SYM("b"), { indexRunId: "run_other" }),
		])
		const rows = await store.listByRun("run_t")
		expect(rows.length).toBe(1)
		expect(rows[0]?.nodeId).toBe(SYM("a"))
	})

	it("listByRun honors limit", async () => {
		await store.upsert([row(SYM("a")), row(SYM("b")), row(SYM("c"))])
		expect((await store.listByRun("run_t", { limit: 2 })).length).toBe(2)
	})

	it("search filters by repoId / indexRunId / payloadKind", async () => {
		await store.upsert([
			row(SYM("a")),
			row(SYM("b"), { repoId: "other" }),
			row(SYM("c"), { payloadKind: "Block" }),
		])
		const hits = await store.search({
			vector: row(SYM("a")).vector,
			limit: 10,
			filter: { repoId: "r", payloadKind: "FunctionSummary" },
		})
		const ids = hits.map((h) => h.nodeId).sort()
		expect(ids).toEqual([SYM("a")])
	})

	it("empty search on a fresh store returns []", async () => {
		const hits = await store.search({
			vector: makeVector(1),
			limit: 5,
		})
		expect(hits).toEqual([])
	})

	it("countByRun on a fresh store returns 0", async () => {
		expect(await store.countByRun("run_t")).toBe(0)
	})

	it("health returns ok", async () => {
		expect((await store.health()).ok).toBe(true)
	})
})
