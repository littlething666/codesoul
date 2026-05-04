import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import {
	EmbeddingCompatibilityError,
	VectorRow as VectorRowSchema,
	type VectorRow,
} from "@codesoul/core"
import type {
	VectorSearchFilter,
	VectorSearchHit,
	VectorStore,
} from "@codesoul/vector-store"

/**
 * Sidecar manifest persisted alongside the LanceDB table.
 *
 * Per the planning doc's §Storage rule, every index manifest must persist
 * the embedder identity so a future search cannot silently mix vectors
 * from different models. We keep this as a small JSON file rather than a
 * second LanceDB table because it is read on every connect / upsert and a
 * file read avoids depending on LanceDB's table catalog being warm.
 */
export type LanceDBManifest = {
	embeddingModel: string
	embeddingRevision: string
	embeddingDim: number
	tokenizerVersion: string
	schemaVersion: 1
}

export type LanceDBVectorStoreOptions = {
	/** Filesystem path (or s3:// / gs:// URI) where the LanceDB table lives. */
	uri: string
	/** Defaults to "vectors". Use a distinct name to colocate multiple tables. */
	tableName?: string
	/**
	 * Override for the manifest sidecar path. Defaults to
	 * `<uri>/codesoul-manifest.json`. Tests use this to pin the manifest
	 * to a tmp file independent of the LanceDB directory.
	 */
	manifestPath?: string
	/**
	 * Optional tokenizer version stamped into the manifest on first write.
	 * Defaults to "unknown" until a real tokenizer pin lands.
	 */
	tokenizerVersion?: string
}

const DEFAULT_TABLE_NAME = "vectors"
const MANIFEST_FILE_NAME = "codesoul-manifest.json"

// ---- Internal row shape ---------------------------------------------------
//
// LanceDB stores typed columns; we flatten VectorRow into a primitive bag
// so the table schema is inferable from the first record. PersistedMeta's
// fields land as TEXT columns; numeric fields stay numeric. The mock store
// uses an in-memory Map keyed by (nodeId, payloadKind) for upsert; we
// emulate the same semantics by deleting matching rows before adding new
// ones.
//
// Read-side note: when LanceDB hands rows back via `toArray()`, the
// `vector` column is an Apache Arrow `Vector`, not a plain `number[]`.
// Arrow Vectors are iterable, so we widen the type here and coerce in
// `fromInternal` rather than fighting the binding's runtime shape.

type InternalRow = {
	nodeId: string
	payloadKind: string
	vector: number[] | ArrayLike<number> | Iterable<number>
	embeddingModel: string
	embeddingRevision: string
	embeddingDim: number
	repoId: string
	indexRunId: string
	batchId: string
	sourcePath: string
	contentHash: string
	schemaVersion: number
}

const toInternal = (r: VectorRow): InternalRow => ({
	nodeId: r.nodeId,
	payloadKind: r.payloadKind,
	vector: r.vector,
	embeddingModel: r.embeddingModel,
	embeddingRevision: r.embeddingRevision,
	embeddingDim: r.embeddingDim,
	repoId: r.repoId,
	indexRunId: r.indexRunId,
	batchId: r.batchId,
	sourcePath: r.sourcePath,
	contentHash: r.contentHash,
	schemaVersion: r.schemaVersion,
})

const toPlainVector = (
	v: number[] | ArrayLike<number> | Iterable<number>,
): number[] => (Array.isArray(v) ? v : Array.from(v as Iterable<number>))

const fromInternal = (r: InternalRow): VectorRow =>
	VectorRowSchema.parse({
		nodeId: r.nodeId,
		payloadKind: r.payloadKind,
		vector: toPlainVector(r.vector),
		embeddingModel: r.embeddingModel,
		embeddingRevision: r.embeddingRevision,
		embeddingDim: r.embeddingDim,
		repoId: r.repoId,
		indexRunId: r.indexRunId,
		batchId: r.batchId,
		sourcePath: r.sourcePath,
		contentHash: r.contentHash,
		schemaVersion: 1,
	})

const escapeSqlString = (s: string): string => s.replace(/'/g, "''")

// ---- LanceDB module shape --------------------------------------------------
//
// We deliberately do NOT use a top-level `import` for @lancedb/lancedb.
// The native bindings can fail to load on machines without prebuilds, and
// we want module-level imports to work cleanly in environments that don't
// have LanceDB installed (e.g. unit-test runners that skip the
// integration suite). Dynamic import + a narrow structural type confine
// the dependency to runtime, similar to how packages/parser/tree-sitter.ts
// uses createRequire to confine the tree-sitter native dep.

interface LanceQuery {
	limit(n: number): LanceQuery
	where(predicate: string): LanceQuery
	toArray(): Promise<unknown[]>
}

interface LanceTable {
	add(records: ReadonlyArray<unknown>): Promise<void>
	delete(predicate: string): Promise<void>
	countRows(filter?: string): Promise<number>
	search(query: number[]): LanceQuery
	query(): LanceQuery
}

interface LanceConnection {
	tableNames(): Promise<string[]>
	openTable(name: string): Promise<LanceTable>
	createTable(
		name: string,
		data: ReadonlyArray<unknown>,
	): Promise<LanceTable>
}

interface LanceModule {
	connect(uri: string): Promise<LanceConnection>
}

let lanceModulePromise: Promise<LanceModule> | null = null
const loadLanceDB = (): Promise<LanceModule> => {
	if (!lanceModulePromise) {
		lanceModulePromise = import("@lancedb/lancedb") as unknown as Promise<
			LanceModule
		>
	}
	return lanceModulePromise
}

/**
 * LanceDB-backed `VectorStore` implementation (Phase 6).
 *
 * Wire-compatibility notes:
 *
 *   - Each LanceDB table is single-identity. The first batch of rows
 *     written to a fresh table fixes the manifest's
 *     (embeddingModel, embeddingRevision, embeddingDim, tokenizerVersion).
 *     Subsequent writes that disagree throw `EmbeddingCompatibilityError`
 *     so a misconfigured embedder cannot silently corrupt the index.
 *   - At search time, we do not have the query's full embedder identity
 *     in the current `VectorStore.search` signature, but we DO know its
 *     dimension. A length mismatch is the most common bug shape (someone
 *     swapped a 768-dim model for the configured 1024-dim one) and we
 *     fail closed there. The cross-run identity invariant lives in
 *     `IngestionManifest` (`@codesoul/manifest-store`) and is enforced at
 *     index time.
 *   - LanceDB has no native upsert primitive. Mirroring `MockVectorStore`'s
 *     `Map<key, row>` semantics, we delete matching `(nodeId, payloadKind)`
 *     rows then `add`, all in one method call. The deletes use parameter
 *     escaping to avoid SQL injection from caller-controlled IDs.
 *
 * Non-goals for this PR:
 *
 *   - Index building (HNSW / IVF_PQ). LanceDB will fall back to a brute
 *     force scan, which is fine at fixture sizes; production deployments
 *     should call `table.createIndex(...)` after the first batch.
 *   - S3 / object-store URIs. The constructor accepts whatever
 *     `lancedb.connect` accepts, but tests run only against local paths.
 */
export class LanceDBVectorStore implements VectorStore {
	private readonly uri: string
	private readonly tableName: string
	private readonly manifestPath: string
	private readonly tokenizerVersion: string
	private connection: LanceConnection | null = null
	private table: LanceTable | null = null
	private manifest: LanceDBManifest | null = null

	constructor(options: LanceDBVectorStoreOptions) {
		this.uri = options.uri
		this.tableName = options.tableName ?? DEFAULT_TABLE_NAME
		this.manifestPath =
			options.manifestPath ?? join(this.uri, MANIFEST_FILE_NAME)
		this.tokenizerVersion = options.tokenizerVersion ?? "unknown"
	}

	private async connect(): Promise<LanceConnection> {
		if (!this.connection) {
			const lancedb = await loadLanceDB()
			this.connection = await lancedb.connect(this.uri)
		}
		return this.connection
	}

	private async loadManifest(): Promise<LanceDBManifest | null> {
		if (this.manifest) return this.manifest
		try {
			const text = await readFile(this.manifestPath, "utf8")
			const parsed = JSON.parse(text) as LanceDBManifest
			this.manifest = parsed
			return parsed
		} catch {
			return null
		}
	}

	private async writeManifest(m: LanceDBManifest): Promise<void> {
		await mkdir(dirname(this.manifestPath), { recursive: true })
		await writeFile(
			this.manifestPath,
			JSON.stringify(m, null, 2),
			"utf8",
		)
		this.manifest = m
	}

	private async getTable(): Promise<LanceTable | null> {
		if (this.table) return this.table
		const conn = await this.connect()
		const names = await conn.tableNames()
		if (!names.includes(this.tableName)) return null
		this.table = await conn.openTable(this.tableName)
		return this.table
	}

	private async ensureTable(
		seed: ReadonlyArray<InternalRow>,
	): Promise<LanceTable> {
		const existing = await this.getTable()
		if (existing) return existing
		const conn = await this.connect()
		this.table = await conn.createTable(this.tableName, seed)
		return this.table
	}

	async upsert(rows: ReadonlyArray<VectorRow>): Promise<void> {
		if (rows.length === 0) return
		const validated = rows.map((r) => VectorRowSchema.parse(r))
		const first = validated[0]
		if (!first) return

		const expected: LanceDBManifest =
			(await this.loadManifest()) ?? {
				embeddingModel: first.embeddingModel,
				embeddingRevision: first.embeddingRevision,
				embeddingDim: first.embeddingDim,
				tokenizerVersion: this.tokenizerVersion,
				schemaVersion: 1,
			}

		for (const r of validated) {
			if (
				r.embeddingModel !== expected.embeddingModel ||
				r.embeddingRevision !== expected.embeddingRevision ||
				r.embeddingDim !== expected.embeddingDim
			) {
				throw new EmbeddingCompatibilityError(
					`vector row identity mismatch: table is pinned to ${expected.embeddingModel}@${expected.embeddingRevision} (dim=${expected.embeddingDim}); got ${r.embeddingModel}@${r.embeddingRevision} (dim=${r.embeddingDim})`,
				)
			}
		}

		if (!this.manifest) {
			await this.writeManifest(expected)
		}

		const internal = validated.map(toInternal)
		const table = await this.ensureTable(internal)

		// Mirror MockVectorStore's `(nodeId, payloadKind)` upsert key. We
		// build a single OR-of-ANDs predicate so multi-row deletes hit the
		// table once instead of N times.
		const clauses = internal.map(
			(r) =>
				`(nodeId = '${escapeSqlString(r.nodeId)}' AND payloadKind = '${escapeSqlString(r.payloadKind)}')`,
		)
		await table.delete(clauses.join(" OR "))
		await table.add(internal)
	}

	async search(query: {
		vector: number[]
		limit: number
		filter?: VectorSearchFilter
	}): Promise<VectorSearchHit[]> {
		const manifest = await this.loadManifest()
		if (!manifest) return []

		if (query.vector.length !== manifest.embeddingDim) {
			throw new EmbeddingCompatibilityError(
				`query vector length ${query.vector.length} does not match table dimension ${manifest.embeddingDim}`,
			)
		}

		const table = await this.getTable()
		if (!table) return []

		let q = table.search(query.vector).limit(query.limit)
		const where = this.buildFilter(query.filter)
		if (where) q = q.where(where)

		const rows = (await q.toArray()) as Array<
			InternalRow & { _distance?: number }
		>
		return rows.map((r) => ({
			nodeId: r.nodeId,
			// LanceDB returns L2 (or cosine) distance; convert to a
			// monotonically-decreasing similarity score so callers can sort
			// descending the same way the mock does.
			score: 1 / (1 + (r._distance ?? 0)),
			payloadKind: r.payloadKind as VectorRow["payloadKind"],
		}))
	}

	private buildFilter(filter?: VectorSearchFilter): string | null {
		if (!filter) return null
		const parts: string[] = []
		if (filter.repoId) {
			parts.push(`repoId = '${escapeSqlString(filter.repoId)}'`)
		}
		if (filter.indexRunId) {
			parts.push(
				`indexRunId = '${escapeSqlString(filter.indexRunId)}'`,
			)
		}
		if (filter.payloadKind) {
			parts.push(
				`payloadKind = '${escapeSqlString(filter.payloadKind)}'`,
			)
		}
		return parts.length === 0 ? null : parts.join(" AND ")
	}

	async listByRun(
		indexRunId: string,
		options: { limit?: number } = {},
	): Promise<VectorRow[]> {
		const table = await this.getTable()
		if (!table) return []
		let q = table
			.query()
			.where(`indexRunId = '${escapeSqlString(indexRunId)}'`)
		if (options.limit && options.limit > 0) q = q.limit(options.limit)
		const rows = (await q.toArray()) as InternalRow[]
		return rows.map(fromInternal)
	}

	async countByRun(indexRunId: string): Promise<number> {
		const table = await this.getTable()
		if (!table) return 0
		return table.countRows(
			`indexRunId = '${escapeSqlString(indexRunId)}'`,
		)
	}

	async health(): Promise<{ ok: boolean; details?: string }> {
		try {
			await this.connect()
			return { ok: true }
		} catch (err) {
			return { ok: false, details: String(err) }
		}
	}

	/**
	 * Drop cached connection / table handles. LanceDB connections are
	 * lightweight and do not need explicit closing today; this exists so
	 * tests can reset state between runs and so a future remote-backed
	 * connection has a place to release sockets.
	 */
	async close(): Promise<void> {
		this.connection = null
		this.table = null
	}
}
