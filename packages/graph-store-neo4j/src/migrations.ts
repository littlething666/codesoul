/**
 * Cypher migrations applied at adapter startup.
 *
 * Phase 3 baseline:
 *
 *   - Single `:Symbol` label keyed by the canonical `sym_<sha1>` stable
 *     id. The unique constraint is the contract every other adapter
 *     piece relies on (MERGE on `(:Symbol { id })`, idempotency, etc.).
 *   - Per-property indexes for the dimensions retrieval / inspection
 *     filters by (`path`, `repoId`, `indexRunId`, `kind`,
 *     `qualifiedName`).
 *
 * The single-label approach is deliberate. Dynamic labels (`:Function`,
 * `:Class`, ...) would force per-kind constraints + indexes and fight
 * Cypher's static label model. Multi-label refinement
 * (`:Symbol:Function`) can layer on later without invalidating the
 * unique-id constraint.
 *
 * `IF NOT EXISTS` makes every statement idempotent; this list is safe
 * to apply on every adapter start. True data migrations (if any) land
 * later, keyed off the persisted `schemaVersion` property.
 */
export const NEO4J_MIGRATIONS: ReadonlyArray<string> = [
	"CREATE CONSTRAINT symbol_id IF NOT EXISTS FOR (s:Symbol) REQUIRE s.id IS UNIQUE",
	"CREATE INDEX symbol_path IF NOT EXISTS FOR (s:Symbol) ON (s.path)",
	"CREATE INDEX symbol_repo IF NOT EXISTS FOR (s:Symbol) ON (s.repoId)",
	"CREATE INDEX symbol_run IF NOT EXISTS FOR (s:Symbol) ON (s.indexRunId)",
	"CREATE INDEX symbol_kind IF NOT EXISTS FOR (s:Symbol) ON (s.kind)",
	"CREATE INDEX symbol_qname IF NOT EXISTS FOR (s:Symbol) ON (s.qualifiedName)",
]
