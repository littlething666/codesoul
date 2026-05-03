/**
 * SQLite schema for the manifest/WAL package.
 *
 * Column names use snake_case to match SQL idioms; TS DTOs use camelCase
 * and adapters translate between them. There are no foreign key cascades
 * for now; events are kept on disk even if a future operator manually
 * deletes a batch_manifest row, so the audit trail is preserved.
 */
export const BATCH_MANIFEST_SQL = `
CREATE TABLE IF NOT EXISTS batch_manifest (
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
CREATE INDEX IF NOT EXISTS idx_batch_manifest_run ON batch_manifest(index_run_id);
CREATE INDEX IF NOT EXISTS idx_batch_manifest_repo ON batch_manifest(repo_id);
CREATE INDEX IF NOT EXISTS idx_batch_manifest_status ON batch_manifest(status);
`

export const BATCH_EVENT_SQL = `
CREATE TABLE IF NOT EXISTS batch_event (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  message TEXT,
  FOREIGN KEY(batch_id) REFERENCES batch_manifest(batch_id)
);
CREATE INDEX IF NOT EXISTS idx_batch_event_batch ON batch_event(batch_id);
`

export const INGESTION_MANIFEST_SQL = `
CREATE TABLE IF NOT EXISTS ingestion_manifest (
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
`

export const SCHEMA_SQL = [
	BATCH_MANIFEST_SQL,
	BATCH_EVENT_SQL,
	INGESTION_MANIFEST_SQL,
].join("\n")
