import type { BatchManifest, IngestionManifest } from "@codesoul/core"
import {
	BatchManifest as BatchManifestSchema,
	IngestionManifest as IngestionManifestSchema,
} from "@codesoul/core"
import type {
	BatchEvent,
	ListBatchesOptions,
	ManifestStore,
	RecordBatchInput,
	TransitionBatchInput,
} from "./manifest-store.js"
import { type Clock, SystemClock } from "./time.js"
import { assertValidTransition } from "./transitions.js"

export type InMemoryManifestStoreOptions = {
	clock?: Clock
}

/**
 * In-memory ManifestStore. Used by Phase 0 wiring and to share a contract
 * test with the SQLite implementation. Not durable; do not use in prod.
 */
export class InMemoryManifestStore implements ManifestStore {
	private readonly batches = new Map<string, BatchManifest>()
	private readonly events: BatchEvent[] = []
	private readonly ingestions = new Map<string, IngestionManifest>()
	private nextEventId = 1
	private readonly clock: Clock

	constructor(options: InMemoryManifestStoreOptions = {}) {
		this.clock = options.clock ?? SystemClock
	}

	async recordBatch(manifest: RecordBatchInput): Promise<void> {
		const parsed = BatchManifestSchema.parse(manifest)
		if (this.batches.has(parsed.batchId)) {
			throw new Error(`Batch already recorded: ${parsed.batchId}`)
		}
		this.batches.set(parsed.batchId, parsed)
		this.events.push({
			eventId: this.nextEventId++,
			batchId: parsed.batchId,
			fromStatus: null,
			toStatus: parsed.status,
			createdAt: parsed.createdAt,
			message: null,
		})
	}

	async transitionBatch(
		input: TransitionBatchInput,
	): Promise<BatchManifest> {
		const existing = this.batches.get(input.batchId)
		if (!existing) {
			throw new Error(`Unknown batch: ${input.batchId}`)
		}
		assertValidTransition(existing.status, input.toStatus)
		const now = this.clock.nowIso()
		const next: BatchManifest = {
			...existing,
			status: input.toStatus,
			committedAt:
				input.toStatus === "committed" ? now : existing.committedAt,
		}
		this.batches.set(next.batchId, next)
		this.events.push({
			eventId: this.nextEventId++,
			batchId: next.batchId,
			fromStatus: existing.status,
			toStatus: next.status,
			createdAt: now,
			message: input.message ?? null,
		})
		return next
	}

	async getBatch(batchId: string): Promise<BatchManifest | null> {
		return this.batches.get(batchId) ?? null
	}

	async listBatchesForRun(
		indexRunId: string,
		options: ListBatchesOptions = {},
	): Promise<BatchManifest[]> {
		const limit =
			options.limit && options.limit > 0
				? options.limit
				: Number.POSITIVE_INFINITY
		const out: BatchManifest[] = []
		for (const m of this.batches.values()) {
			if (m.indexRunId !== indexRunId) continue
			if (options.status && m.status !== options.status) continue
			out.push(m)
			if (out.length >= limit) break
		}
		return out
	}

	async listEvents(batchId: string): Promise<BatchEvent[]> {
		return this.events
			.filter((e) => e.batchId === batchId)
			.sort((a, b) => a.eventId - b.eventId)
	}

	async recordIngestion(manifest: IngestionManifest): Promise<void> {
		const parsed = IngestionManifestSchema.parse(manifest)
		this.ingestions.set(parsed.indexRunId, parsed)
	}

	async finishIngestion(
		indexRunId: string,
		finishedAt: string,
	): Promise<IngestionManifest> {
		const existing = this.ingestions.get(indexRunId)
		if (!existing) {
			throw new Error(`Unknown ingestion: ${indexRunId}`)
		}
		const next: IngestionManifest = { ...existing, finishedAt }
		this.ingestions.set(indexRunId, next)
		return next
	}

	async getIngestion(
		indexRunId: string,
	): Promise<IngestionManifest | null> {
		return this.ingestions.get(indexRunId) ?? null
	}

	async health(): Promise<{ ok: boolean; details?: string }> {
		return { ok: true }
	}

	async close(): Promise<void> {
		// no-op
	}
}
