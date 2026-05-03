import { describe, expect, it } from "vitest"
import type { BatchManifest } from "@codesoul/core"
import { ManifestStateError } from "@codesoul/core"
import { transitionStatus } from "../manifest.js"

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
	it("allows pending -> committed and stamps committedAt", () => {
		const next = transitionStatus(base, "committed")
		expect(next.status).toBe("committed")
		expect(next.committedAt).not.toBeNull()
	})

	it("allows pending -> failed", () => {
		const next = transitionStatus(base, "failed")
		expect(next.status).toBe("failed")
	})

	it("rejects committed -> pending", () => {
		const committed = transitionStatus(base, "committed")
		expect(() => transitionStatus(committed, "pending")).toThrow(
			ManifestStateError,
		)
	})
})
