import type { BatchManifest, BatchStatus } from "@codesoul/core"
import { ManifestStateError } from "@codesoul/core"

const VALID_TRANSITIONS: Record<BatchStatus, ReadonlyArray<BatchStatus>> = {
	pending: ["committed", "failed"],
	committed: [],
	failed: [],
}

export const transitionStatus = (
	manifest: BatchManifest,
	next: BatchStatus,
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
			next === "committed" ? new Date().toISOString() : manifest.committedAt,
	}
}
