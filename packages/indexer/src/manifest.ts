import type { BatchManifest, BatchStatus } from "@codesoul/core"
import { ManifestStateError } from "@codesoul/core"
import { type Clock, SystemClock } from "./time.js"

const VALID_TRANSITIONS: Record<BatchStatus, ReadonlyArray<BatchStatus>> = {
	pending: ["committed", "failed", "dry_run"],
	committed: [],
	failed: [],
	dry_run: [],
}

export const transitionStatus = (
	manifest: BatchManifest,
	next: BatchStatus,
	clock: Clock = SystemClock,
): BatchManifest => {
	const allowed = VALID_TRANSITIONS[manifest.status]
	if (!allowed.includes(next)) {
		throw new ManifestStateError(
			`Invalid manifest transition: ${manifest.status} -> ${next}`,
		)
	}
	return {
		...manifest,
		status: next,
		committedAt:
			next === "committed" ? clock.nowIso() : manifest.committedAt,
	}
}
