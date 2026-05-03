/**
 * Pluggable wall clock for the indexer.
 *
 * SystemClock is the production default; tests should inject a fake clock
 * to make outputs byte-identical.
 */
export interface Clock {
	nowIso(): string
}

export const SystemClock: Clock = {
	nowIso: () => new Date().toISOString(),
}
