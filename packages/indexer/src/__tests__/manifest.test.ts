import { describe, expect, it } from "vitest"
import type { BatchManifest } from "@codesoul/core"
import { ManifestStateError } from "@codesoul/core"
import { transitionStatus } from "../manifest.js"
import type { Clock } from "../time.js"

const FIXED = "2026-01-01T00:00:00.000Z"
const clock: Clock = { nowIso: () => FIXED }

const base: BatchManifest = {
	batchId: "batch_x",
	indexRunId: "run_x",
	repoId: "repo_x",
	sourcePath: "/repo",
	sourceContentHash: `cnt_${"a".repeat(40)}`,
	status: "pending",
	nodeCount: 0,
	edgeCount: 0,
	vectorCount: 0,
	createdAt: "2026-01-01T00:00:00.000Z",
	committedAt: null,
	checksum: "x",
	schemaVersion: 1,
}

describe("transitionStatus", () => {
	it("allows pending -> committed and stamps committedAt via the clock", () => {
		const next = transitionStatus(base, "committed", clock)
		expect(next.status).toBe("committed")
		expect(next.committedAt).toBe(FIXED)
	})

	it("allows pending -> failed (committedAt unchanged)", () => {
		const next = transitionStatus(base, "failed", clock)
		expect(next.status).toBe("failed")
		expect(next.committedAt).toBeNull()
	})

	it("allows pending -> dry_run", () => {
		const next = transitionStatus(base, "dry_run", clock)
		expect(next.status).toBe("dry_run")
	})

	it("rejects committed -> pending", () => {
		const committed = transitionStatus(base, "committed", clock)
		expect(() => transitionStatus(committed, "pending", clock)).toThrow(
			ManifestStateError,
		)
	})

	it("rejects committed -> failed", () => {
		const committed = transitionStatus(base, "committed", clock)
		expect(() => transitionStatus(committed, "failed", clock)).toThrow(
			ManifestStateError,
		)
	})

	it("is byte-identical for the same transition with a fixed clock", () => {
		const a = transitionStatus(base, "committed", clock)
		const b = transitionStatus(base, "committed", clock)
		expect(a).toEqual(b)
	})
})
