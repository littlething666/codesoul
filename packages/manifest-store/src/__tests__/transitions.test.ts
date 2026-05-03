import { describe, expect, it } from "vitest"
import { ManifestStateError } from "@codesoul/core"
import { assertValidTransition, isValidTransition } from "../transitions.js"

describe("transitions", () => {
	it("allows pending -> committed | failed | dry_run", () => {
		expect(isValidTransition("pending", "committed")).toBe(true)
		expect(isValidTransition("pending", "failed")).toBe(true)
		expect(isValidTransition("pending", "dry_run")).toBe(true)
	})

	it("treats committed/failed/dry_run as terminal", () => {
		for (const from of ["committed", "failed", "dry_run"] as const) {
			for (const to of [
				"committed",
				"failed",
				"dry_run",
				"pending",
			] as const) {
				expect(isValidTransition(from, to)).toBe(false)
			}
		}
	})

	it("assertValidTransition throws ManifestStateError", () => {
		expect(() => assertValidTransition("committed", "pending")).toThrow(
			ManifestStateError,
		)
	})
})
