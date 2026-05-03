import { expect, it } from "vitest"
import type { BatchManifest, IngestionManifest } from "@codesoul/core"
import { ManifestStateError } from "@codesoul/core"
import type { ManifestStore } from "../manifest-store.js"

const FIXED = "2026-01-01T00:00:00.000Z"
const CNT = `cnt_${"a".repeat(40)}`

const baseManifest: BatchManifest = {
	batchId: "batch_t",
	indexRunId: "run_t",
	repoId: "repo_t",
	sourcePath: "/repo",
	sourceContentHash: CNT,
	status: "pending",
	nodeCount: 0,
	edgeCount: 0,
	vectorCount: 0,
	createdAt: FIXED,
	committedAt: null,
	checksum: "x",
	schemaVersion: 1,
}

const baseIngestion: IngestionManifest = {
	indexRunId: "run_t",
	repoId: "repo_t",
	startedAt: FIXED,
	finishedAt: null,
	embeddingModel: "mock",
	embeddingRevision: "0",
	embeddingDim: 1024,
	rerankerModel: null,
	rerankerRevision: null,
	tokenizerVersion: "mock-0",
	schemaVersion: 1,
}

/**
 * Shared contract test for any ManifestStore implementation. The same
 * suite runs against InMemoryManifestStore and SqliteManifestStore (with a
 * `:memory:` database), so any divergence between the two surfaces here.
 */
export const runManifestStoreContract = (
	factory: () => ManifestStore,
): void => {
	it("recordBatch persists the manifest and emits a creation event", async () => {
		const store = factory()
		try {
			await store.recordBatch(baseManifest)
			expect(await store.getBatch("batch_t")).toEqual(baseManifest)
			const events = await store.listEvents("batch_t")
			expect(events.length).toBe(1)
			expect(events[0]?.fromStatus).toBeNull()
			expect(events[0]?.toStatus).toBe("pending")
			expect(events[0]?.message).toBeNull()
		} finally {
			await store.close()
		}
	})

	it("transitionBatch pending -> committed stamps committedAt", async () => {
		const store = factory()
		try {
			await store.recordBatch(baseManifest)
			const next = await store.transitionBatch({
				batchId: "batch_t",
				toStatus: "committed",
				message: "ok",
			})
			expect(next.status).toBe("committed")
			expect(next.committedAt).toBe(FIXED)
			const events = await store.listEvents("batch_t")
			expect(events.length).toBe(2)
			expect(events[1]?.fromStatus).toBe("pending")
			expect(events[1]?.toStatus).toBe("committed")
			expect(events[1]?.message).toBe("ok")
		} finally {
			await store.close()
		}
	})

	it("transitionBatch pending -> failed leaves committedAt null", async () => {
		const store = factory()
		try {
			await store.recordBatch(baseManifest)
			const next = await store.transitionBatch({
				batchId: "batch_t",
				toStatus: "failed",
			})
			expect(next.status).toBe("failed")
			expect(next.committedAt).toBeNull()
		} finally {
			await store.close()
		}
	})

	it("transitionBatch pending -> dry_run leaves committedAt null", async () => {
		const store = factory()
		try {
			await store.recordBatch(baseManifest)
			const next = await store.transitionBatch({
				batchId: "batch_t",
				toStatus: "dry_run",
			})
			expect(next.status).toBe("dry_run")
			expect(next.committedAt).toBeNull()
		} finally {
			await store.close()
		}
	})

	it("rejects committed -> pending", async () => {
		const store = factory()
		try {
			await store.recordBatch(baseManifest)
			await store.transitionBatch({
				batchId: "batch_t",
				toStatus: "committed",
			})
			await expect(
				store.transitionBatch({
					batchId: "batch_t",
					toStatus: "pending",
				}),
			).rejects.toBeInstanceOf(ManifestStateError)
		} finally {
			await store.close()
		}
	})

	it("rejects committed -> failed", async () => {
		const store = factory()
		try {
			await store.recordBatch(baseManifest)
			await store.transitionBatch({
				batchId: "batch_t",
				toStatus: "committed",
			})
			await expect(
				store.transitionBatch({
					batchId: "batch_t",
					toStatus: "failed",
				}),
			).rejects.toBeInstanceOf(ManifestStateError)
		} finally {
			await store.close()
		}
	})

	it("transitionBatch on unknown batch throws", async () => {
		const store = factory()
		try {
			await expect(
				store.transitionBatch({
					batchId: "batch_missing",
					toStatus: "committed",
				}),
			).rejects.toBeInstanceOf(Error)
		} finally {
			await store.close()
		}
	})

	it("recordBatch is not idempotent: duplicate batchId throws", async () => {
		const store = factory()
		try {
			await store.recordBatch(baseManifest)
			await expect(store.recordBatch(baseManifest)).rejects.toBeInstanceOf(
				Error,
			)
		} finally {
			await store.close()
		}
	})

	it("listBatchesForRun filters by run", async () => {
		const store = factory()
		try {
			await store.recordBatch(baseManifest)
			await store.recordBatch({
				...baseManifest,
				batchId: "batch_other",
				indexRunId: "run_other",
			})
			const t = await store.listBatchesForRun("run_t")
			expect(t.length).toBe(1)
			expect(t[0]?.batchId).toBe("batch_t")
		} finally {
			await store.close()
		}
	})

	it("listBatchesForRun filters by status", async () => {
		const store = factory()
		try {
			await store.recordBatch(baseManifest)
			await store.recordBatch({
				...baseManifest,
				batchId: "batch_committed",
			})
			await store.transitionBatch({
				batchId: "batch_committed",
				toStatus: "committed",
			})
			const committed = await store.listBatchesForRun("run_t", {
				status: "committed",
			})
			expect(committed.length).toBe(1)
			expect(committed[0]?.batchId).toBe("batch_committed")
		} finally {
			await store.close()
		}
	})

	it("listBatchesForRun honors limit", async () => {
		const store = factory()
		try {
			await store.recordBatch(baseManifest)
			await store.recordBatch({ ...baseManifest, batchId: "batch_2" })
			await store.recordBatch({ ...baseManifest, batchId: "batch_3" })
			const limited = await store.listBatchesForRun("run_t", { limit: 2 })
			expect(limited.length).toBe(2)
		} finally {
			await store.close()
		}
	})

	it("recordIngestion + getIngestion roundtrip", async () => {
		const store = factory()
		try {
			await store.recordIngestion(baseIngestion)
			expect(await store.getIngestion("run_t")).toEqual(baseIngestion)
		} finally {
			await store.close()
		}
	})

	it("finishIngestion stamps finishedAt", async () => {
		const store = factory()
		try {
			await store.recordIngestion(baseIngestion)
			const finished = await store.finishIngestion("run_t", FIXED)
			expect(finished.finishedAt).toBe(FIXED)
		} finally {
			await store.close()
		}
	})

	it("recordIngestion is upsert (same indexRunId overwrites)", async () => {
		const store = factory()
		try {
			await store.recordIngestion(baseIngestion)
			await store.recordIngestion({ ...baseIngestion, embeddingModel: "mock-2" })
			const latest = await store.getIngestion("run_t")
			expect(latest?.embeddingModel).toBe("mock-2")
		} finally {
			await store.close()
		}
	})

	it("health returns ok", async () => {
		const store = factory()
		try {
			expect((await store.health()).ok).toBe(true)
		} finally {
			await store.close()
		}
	})
}
