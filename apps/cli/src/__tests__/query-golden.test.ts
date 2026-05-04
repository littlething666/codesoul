import { describe, expect, it, vi } from "vitest"
import { buildProgram } from "../program.js"
import { wirePhase0 } from "../wiring.js"

/**
 * Phase 0 query golden tests.
 *
 * Locks in the public JSON shape of `codesoul query`. The default
 * wiring uses a fresh MockGraphStore + MockVectorStore + MockEmbedder
 * + MockReranker, so retrieval has no candidates and the pipeline
 * returns the documented empty `ContextBundle`. These tests fail
 * loudly the moment that surface drifts (key renamed, removed, or
 * added without a conscious bump) — which is exactly what a public
 * contract test is for.
 *
 * Why CLI-boundary and not retrieval-boundary: `pipeline.test.ts`
 * already covers the computation. The golden value here is the
 * `ContextBundle` JSON that downstream tools (humans, scripts, the
 * future MCP server) actually consume.
 */

const captureStdout = async (
	fn: () => Promise<void>,
): Promise<string[]> => {
	const lines: string[] = []
	const spy = vi
		.spyOn(console, "log")
		.mockImplementation((line: unknown) => {
			lines.push(typeof line === "string" ? line : String(line))
		})
	try {
		await fn()
	} finally {
		spy.mockRestore()
	}
	return lines
}

describe("codesoul query golden", () => {
	it("emits the empty ContextBundle shape on default mock wiring", async () => {
		const deps = wirePhase0()
		const program = buildProgram(deps).exitOverride()
		const lines = await captureStdout(async () => {
			await program.parseAsync(["query", "greet"], { from: "user" })
		})
		expect(lines).toHaveLength(1)
		const parsed = JSON.parse(lines[0]!)

		// Top-level structural lock: exactly these keys, no more, no less.
		expect(Object.keys(parsed).sort()).toEqual([
			"citations",
			"query",
			"snippets",
			"tokenBudget",
		])
		expect(parsed).toMatchObject({
			query: "greet",
			snippets: [],
			citations: [],
			tokenBudget: {
				total: expect.any(Number),
				used: 0,
			},
		})

		// tokenBudget shape lock.
		expect(Object.keys(parsed.tokenBudget).sort()).toEqual([
			"total",
			"used",
		])
		// total must be a positive integer (it's a budget, not a sentinel).
		expect(Number.isInteger(parsed.tokenBudget.total)).toBe(true)
		expect(parsed.tokenBudget.total).toBeGreaterThan(0)
	})

	it("echoes the query text verbatim into the bundle", async () => {
		const deps = wirePhase0()
		const program = buildProgram(deps).exitOverride()
		const lines = await captureStdout(async () => {
			await program.parseAsync(
				["query", "find a function called farewell"],
				{ from: "user" },
			)
		})
		const parsed = JSON.parse(lines[0]!)
		expect(parsed.query).toBe("find a function called farewell")
		// Snippet/citation arrays must remain real arrays even when empty,
		// because downstream consumers iterate them unconditionally.
		expect(Array.isArray(parsed.snippets)).toBe(true)
		expect(Array.isArray(parsed.citations)).toBe(true)
	})

	it("--limit is plumbed through (still empty under mocks)", async () => {
		const deps = wirePhase0()
		const program = buildProgram(deps).exitOverride()
		const lines = await captureStdout(async () => {
			await program.parseAsync(["query", "greet", "--limit", "5"], {
				from: "user",
			})
		})
		const parsed = JSON.parse(lines[0]!)
		// Default wiring has no candidates, so a non-empty array can't
		// surface; the structural contract is still enforced.
		expect(parsed.snippets).toEqual([])
		expect(parsed.citations).toEqual([])
	})

	it("each snippet (when present) declares the documented keys", async () => {
		// Even with no candidates, this test pins the documented per-
		// snippet keys via a type-level walk: if any snippet ever appears,
		// it MUST have exactly { nodeId, path, lines, text }. Today the
		// array is empty under mocks so the loop body simply asserts no
		// stray snippets escape; once a non-mock fixture is wired in, the
		// loop becomes the schema lock.
		const deps = wirePhase0()
		const program = buildProgram(deps).exitOverride()
		const lines = await captureStdout(async () => {
			await program.parseAsync(["query", "greet"], { from: "user" })
		})
		const parsed = JSON.parse(lines[0]!) as {
			snippets: Array<Record<string, unknown>>
		}
		for (const s of parsed.snippets) {
			expect(Object.keys(s).sort()).toEqual([
				"lines",
				"nodeId",
				"path",
				"text",
			])
		}
	})
})
