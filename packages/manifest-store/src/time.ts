/**
 * Pluggable wall clock for the manifest store, mirroring the indexer's
 * `Clock` shape so a single fake clock can drive both packages from tests.
 */
export interface Clock {
	nowIso(): string
}

export const SystemClock: Clock = {
	nowIso: () => new Date().toISOString(),
}
