import { describe, expect, it, vi } from "vitest"
import type { Phase0Deps } from "../wiring.js"
import { wirePhase0 } from "../wiring.js"
import { buildProgram } from "../program.js"

const makeDeps = (overrides: Partial<Phase0Deps> = {}): Phase0Deps => {
	const base = wirePhase0()
	return { ...base, ...overrides }
}

describe("codesoul query --limit", () => {
	it("rejects non-integer values", async () => {
		const deps = makeDeps()
		const program = buildProgram(deps).exitOverride()
		await expect(
			program.parseAsync(["query", "greet", "--limit", "abc"], {
				from: "user",
			}),
		).rejects.toBeInstanceOf(Error)
	})

	it("rejects 0", async () => {
		const deps = makeDeps()
		const program = buildProgram(deps).exitOverride()
		await expect(
			program.parseAsync(["query", "greet", "--limit", "0"], {
				from: "user",
			}),
		).rejects.toBeInstanceOf(Error)
	})

	it("accepts positive integers", async () => {
		const deps = makeDeps()
		const program = buildProgram(deps).exitOverride()
		const spy = vi.spyOn(console, "log").mockImplementation(() => {})
		try {
			await program.parseAsync(["query", "greet", "--limit", "3"], {
				from: "user",
			})
		} finally {
			spy.mockRestore()
		}
	})
})

describe("codesoul index", () => {
	it("calls indexer.indexRepository with parsed options", async () => {
		const calls: Array<Record<string, unknown>> = []
		const base = wirePhase0()
		const deps: Phase0Deps = {
			...base,
			indexer: {
				async indexRepository(input) {
					calls.push(input as unknown as Record<string, unknown>)
					return {
						manifest: {
							batchId: "batch_t",
							indexRunId: input.indexRunId,
							repoId: input.repoId,
							sourcePath: input.repoPath,
							sourceContentHash: `cnt_${"a".repeat(40)}`,
							status: input.dryRun ? "dry_run" : "committed",
							nodeCount: 0,
							edgeCount: 0,
							vectorCount: 0,
							createdAt: "2026-01-01T00:00:00.000Z",
							committedAt: input.dryRun ? null : "2026-01-01T00:00:00.000Z",
							checksum: "x",
							schemaVersion: 1,
						},
						nodeCount: 0,
						edgeCount: 0,
						vectorCount: 0,
					}
				},
			},
		}
		const program = buildProgram(deps).exitOverride()
		const spy = vi.spyOn(console, "log").mockImplementation(() => {})
		try {
			await program.parseAsync(
				["index", "./fixtures/tiny-ts-lib", "--dry-run"],
				{ from: "user" },
			)
		} finally {
			spy.mockRestore()
		}
		expect(calls.length).toBe(1)
		expect(calls[0]).toMatchObject({
			repoPath: "./fixtures/tiny-ts-lib",
			dryRun: true,
		})
	})
})
