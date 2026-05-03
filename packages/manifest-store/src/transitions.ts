import type { BatchStatus } from "@codesoul/core"
import { ManifestStateError } from "@codesoul/core"

const VALID_TRANSITIONS: Record<BatchStatus, ReadonlyArray<BatchStatus>> = {
	pending: ["committed", "failed", "dry_run"],
	committed: [],
	failed: [],
	dry_run: [],
}

export const isValidTransition = (
	from: BatchStatus,
	to: BatchStatus,
): boolean => VALID_TRANSITIONS[from].includes(to)

export const assertValidTransition = (
	from: BatchStatus,
	to: BatchStatus,
): void => {
	if (!isValidTransition(from, to)) {
		throw new ManifestStateError(
			`Invalid manifest transition: ${from} -> ${to}`,
		)
	}
}
