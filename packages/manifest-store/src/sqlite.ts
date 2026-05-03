import BetterSqlite3 from "better-sqlite3"
import type {
	BatchManifest,
	BatchStatus,
	IngestionManifest,
} from "@codesoul/core"
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
import { SCHEMA_SQL } from "./schema.js"
import { type Clock, SystemClock } from "./time.js"
import { assertValidTransition } from "./transitions.js"

type BatchRow = {
	batch_id: string
	index_run_id: string
	repo_id: string
	source_path: string
	source_content_hash: string
	status: string
	node_count: number
	edge_count: number
	vector_count: number
	created_at: string
	committed_at: string | null
	checksum: string
	schema_version: number
}

type EventRow = {
	event_id: number
	batch_id: string
	from_status: string | null
	to_status: string
	created_at: string
	message: string | null
}

type IngestionRow = {
	index_run_id: string
	repo_id: string
	started_at: string
	finished_at: string | null
	embedding_model: string
	embedding_revision: string
	embedding_dim: number
	reranker_model: string | null
	reranker_revision: string | null
	tokenizer_version: string
	schema_version: number
}

const rowToBatch = (r: BatchRow): BatchManifest =>
	BatchManifestSchema.parse({
		batchId: r.batch_id,
		indexRunId: r.index_run_id,
		repoId: r.repo_id,
		sourcePath: r.source_path,
		sourceContentHash: r.source_content_hash,
		status: r.status as BatchStatus,
		nodeCount: r.node_count,
		edgeCount: r.edge_count,
		vectorCount: r.vector_count,
		createdAt: r.created_at,
		committedAt: r.committed_at,
		checksum: r.checksum,
		schemaVersion: 1,
	})

const rowToEvent = (r: EventRow): BatchEvent => ({
	eventId: r.event_id,
	batchId: r.batch_id,
	fromStatus: (r.from_status as BatchStatus | null) ?? null,
	toStatus: r.to_status as BatchStatus,
	createdAt: r.created_at,
	message: r.message,
})

const rowToIngestion = (r: IngestionRow): IngestionManifest =>
	IngestionManifestSchema.parse({
		indexRunId: r.index_run_id,
		repoId: r.repo_id,
		startedAt: r.started_at,
		finishedAt: r.finished_at,
		embeddingModel: r.embedding_model,
		embeddingRevision: r.embedding_revision,
		embeddingDim: r.embedding_dim,
		rerankerModel: r.reranker_model,
		rerankerRevision: r.reranker_revision,
		tokenizerVersion: r.tokenizer_version,
		schemaVersion: 1,
	})

export type SqliteManifestStoreOptions = {
	clock?: Clock
	/** Apply WAL journal mode + foreign key enforcement. Defaults to true. */
	configurePragmas?: boolean
}

/**
 * SQLite-backed ManifestStore using better-sqlite3 in WAL journal mode.
 *
 * Pass `:memory:` for an ephemeral in-memory database (used by tests). For
 * a real index run, pass an absolute path; the schema is auto-applied via
 * `CREATE TABLE IF NOT EXISTS`. True schema migrations land in a later
 * phase when `schema_version` advances past 1.
 */
export class SqliteManifestStore implements ManifestStore {
	private readonly db: InstanceType<typeof BetterSqlite3>
	private readonly clock: Clock

	constructor(path: string, options: SqliteManifestStoreOptions = {}) {
		this.db = new BetterSqlite3(path)
		if (options.configurePragmas !== false) {
			this.db.pragma("journal_mode = WAL")
			this.db.pragma("foreign_keys = ON")
		}
		this.db.exec(SCHEMA_SQL)
		this.clock = options.clock ?? SystemClock
	}

	async recordBatch(manifest: RecordBatchInput): Promise<void> {
		const m = BatchManifestSchema.parse(manifest)
		const insert = this.db.prepare(
			`INSERT INTO batch_manifest (
        batch_id, index_run_id, repo_id, source_path, source_content_hash,
        status, node_count, edge_count, vector_count,
        created_at, committed_at, checksum, schema_version
      ) VALUES (
        @batch_id, @index_run_id, @repo_id, @source_path, @source_content_hash,
        @status, @node_count, @edge_count, @vector_count,
        @created_at, @committed_at, @checksum, @schema_version
      )`,
		)
		const insertEvent = this.db.prepare(
			`INSERT INTO batch_event (batch_id, from_status, to_status, created_at, message)
       VALUES (@batch_id, NULL, @to_status, @created_at, NULL)`,
		)
		const tx = this.db.transaction(() => {
			insert.run({
				batch_id: m.batchId,
				index_run_id: m.indexRunId,
				repo_id: m.repoId,
				source_path: m.sourcePath,
				source_content_hash: m.sourceContentHash,
				status: m.status,
				node_count: m.nodeCount,
				edge_count: m.edgeCount,
				vector_count: m.vectorCount,
				created_at: m.createdAt,
				committed_at: m.committedAt,
				checksum: m.checksum,
				schema_version: m.schemaVersion,
			})
			insertEvent.run({
				batch_id: m.batchId,
				to_status: m.status,
				created_at: m.createdAt,
			})
		})
		tx()
	}

	async transitionBatch(
		input: TransitionBatchInput,
	): Promise<BatchManifest> {
		const select = this.db.prepare(
			`SELECT * FROM batch_manifest WHERE batch_id = ?`,
		)
		const update = this.db.prepare(
			`UPDATE batch_manifest SET status = @status, committed_at = @committed_at WHERE batch_id = @batch_id`,
		)
		const insertEvent = this.db.prepare(
			`INSERT INTO batch_event (batch_id, from_status, to_status, created_at, message)
       VALUES (@batch_id, @from_status, @to_status, @created_at, @message)`,
		)

		const tx = this.db.transaction(() => {
			const existing = select.get(input.batchId) as BatchRow | undefined
			if (!existing) {
				throw new Error(`Unknown batch: ${input.batchId}`)
			}
			const fromStatus = existing.status as BatchStatus
			assertValidTransition(fromStatus, input.toStatus)
			const now = this.clock.nowIso()
			const committedAt =
				input.toStatus === "committed" ? now : existing.committed_at
			update.run({
				batch_id: input.batchId,
				status: input.toStatus,
				committed_at: committedAt,
			})
			insertEvent.run({
				batch_id: input.batchId,
				from_status: fromStatus,
				to_status: input.toStatus,
				created_at: now,
				message: input.message ?? null,
			})
			const updated = select.get(input.batchId) as BatchRow | undefined
			if (!updated) {
				throw new Error(
					`Batch disappeared mid-transition: ${input.batchId}`,
				)
			}
			return updated
		})

		return rowToBatch(tx())
	}

	async getBatch(batchId: string): Promise<BatchManifest | null> {
		const row = this.db
			.prepare(`SELECT * FROM batch_manifest WHERE batch_id = ?`)
			.get(batchId) as BatchRow | undefined
		return row ? rowToBatch(row) : null
	}

	async listBatchesForRun(
		indexRunId: string,
		options: ListBatchesOptions = {},
	): Promise<BatchManifest[]> {
		let sql = `SELECT * FROM batch_manifest WHERE index_run_id = @index_run_id`
		const params: Record<string, unknown> = { index_run_id: indexRunId }
		if (options.status) {
			sql += ` AND status = @status`
			params.status = options.status
		}
		sql += ` ORDER BY created_at ASC`
		if (options.limit && options.limit > 0) {
			sql += ` LIMIT @limit`
			params.limit = options.limit
		}
		const rows = this.db.prepare(sql).all(params) as BatchRow[]
		return rows.map(rowToBatch)
	}

	async listEvents(batchId: string): Promise<BatchEvent[]> {
		const rows = this.db
			.prepare(
				`SELECT * FROM batch_event WHERE batch_id = ? ORDER BY event_id ASC`,
			)
			.all(batchId) as EventRow[]
		return rows.map(rowToEvent)
	}

	async recordIngestion(manifest: IngestionManifest): Promise<void> {
		const m = IngestionManifestSchema.parse(manifest)
		this.db
			.prepare(
				`INSERT INTO ingestion_manifest (
          index_run_id, repo_id, started_at, finished_at,
          embedding_model, embedding_revision, embedding_dim,
          reranker_model, reranker_revision, tokenizer_version, schema_version
        ) VALUES (
          @index_run_id, @repo_id, @started_at, @finished_at,
          @embedding_model, @embedding_revision, @embedding_dim,
          @reranker_model, @reranker_revision, @tokenizer_version, @schema_version
        )
        ON CONFLICT(index_run_id) DO UPDATE SET
          repo_id = excluded.repo_id,
          started_at = excluded.started_at,
          finished_at = excluded.finished_at,
          embedding_model = excluded.embedding_model,
          embedding_revision = excluded.embedding_revision,
          embedding_dim = excluded.embedding_dim,
          reranker_model = excluded.reranker_model,
          reranker_revision = excluded.reranker_revision,
          tokenizer_version = excluded.tokenizer_version,
          schema_version = excluded.schema_version`,
			)
			.run({
				index_run_id: m.indexRunId,
				repo_id: m.repoId,
				started_at: m.startedAt,
				finished_at: m.finishedAt,
				embedding_model: m.embeddingModel,
				embedding_revision: m.embeddingRevision,
				embedding_dim: m.embeddingDim,
				reranker_model: m.rerankerModel,
				reranker_revision: m.rerankerRevision,
				tokenizer_version: m.tokenizerVersion,
				schema_version: m.schemaVersion,
			})
	}

	async finishIngestion(
		indexRunId: string,
		finishedAt: string,
	): Promise<IngestionManifest> {
		const select = this.db.prepare(
			`SELECT * FROM ingestion_manifest WHERE index_run_id = ?`,
		)
		const update = this.db.prepare(
			`UPDATE ingestion_manifest SET finished_at = @finished_at WHERE index_run_id = @index_run_id`,
		)
		const tx = this.db.transaction(() => {
			const existing = select.get(indexRunId) as IngestionRow | undefined
			if (!existing) {
				throw new Error(`Unknown ingestion: ${indexRunId}`)
			}
			update.run({ index_run_id: indexRunId, finished_at: finishedAt })
			const updated = select.get(indexRunId) as IngestionRow | undefined
			if (!updated) {
				throw new Error(`Ingestion disappeared mid-update: ${indexRunId}`)
			}
			return updated
		})
		return rowToIngestion(tx())
	}

	async getIngestion(
		indexRunId: string,
	): Promise<IngestionManifest | null> {
		const row = this.db
			.prepare(`SELECT * FROM ingestion_manifest WHERE index_run_id = ?`)
			.get(indexRunId) as IngestionRow | undefined
		return row ? rowToIngestion(row) : null
	}

	async health(): Promise<{ ok: boolean; details?: string }> {
		try {
			this.db.prepare(`SELECT 1`).get()
			return { ok: true }
		} catch (err) {
			return { ok: false, details: String(err) }
		}
	}

	async close(): Promise<void> {
		this.db.close()
	}
}
