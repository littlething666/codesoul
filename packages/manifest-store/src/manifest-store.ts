import type {
	BatchManifest,
	BatchStatus,
	IngestionManifest,
} from "@codesoul/core"

/**
 * One row of the `batch_event` table: an audit trail of every status
 * change applied to a batch (including the initial creation).
 */
export type BatchEvent = {
	eventId: number
	batchId: string
	fromStatus: BatchStatus | null
	toStatus: BatchStatus
	createdAt: string
	message: string | null
}

export type RecordBatchInput = BatchManifest

export type TransitionBatchInput = {
	batchId: string
	toStatus: BatchStatus
	message?: string
}

export type ListBatchesOptions = {
	status?: BatchStatus
	limit?: number
}

/**
 * Backend-agnostic manifest/WAL contract.
 *
 * The store owns three logical entities:
 *
 *   - batch_manifest:    one row per batch (pending/committed/failed/dry_run)
 *   - batch_event:       append-only history of status transitions
 *   - ingestion_manifest: one row per index run, recording the embedder /
 *                        reranker / tokenizer identity used for that run
 *
 * Implementations MUST treat record + transition as a single durable unit
 * (one SQLite transaction, or equivalent for in-memory tests) so a partial
 * write cannot leave the WAL in an inconsistent state.
 */
export interface ManifestStore {
	recordBatch(manifest: RecordBatchInput): Promise<void>
	transitionBatch(input: TransitionBatchInput): Promise<BatchManifest>
	getBatch(batchId: string): Promise<BatchManifest | null>
	listBatchesForRun(
		indexRunId: string,
		options?: ListBatchesOptions,
	): Promise<BatchManifest[]>
	listEvents(batchId: string): Promise<BatchEvent[]>
	recordIngestion(manifest: IngestionManifest): Promise<void>
	finishIngestion(
		indexRunId: string,
		finishedAt: string,
	): Promise<IngestionManifest>
	getIngestion(indexRunId: string): Promise<IngestionManifest | null>
	health(): Promise<{ ok: boolean; details?: string }>
	close(): Promise<void>
}
