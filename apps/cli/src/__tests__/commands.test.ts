import { describe, expect, it, vi } from "vitest"
import { MockParser } from "@codesoul/parser/mock"
import { TreeSitterParser } from "@codesoul/parser/tree-sitter"
import type { Phase0Deps } from "../wiring.js"
import { wirePhase0 } from "../wiring.js"
import { buildProgram } from "../program.js"

const makeDeps = (overrides: Partial<Phase0Deps> = {}): Phase0Deps => {
	const base = wirePhase0()
	return { ...base, ...overrides }
}

const stubManifest = (input: {
	repoId: string
	indexRunId: string
	repoPath: string
	dryRun?: boolean
}) => ({
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
})

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
					return stubManifest(input)
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

	it("rejects unknown --parser modes", async () => {
		const deps = makeDeps()
		const program = buildProgram(deps).exitOverride()
		await expect(
			program.parseAsync(
				["index", "./fixtures/tiny-ts-lib", "--dry-run", "--parser", "foo"],
				{ from: "user" },
			),
		).rejects.toBeInstanceOf(Error)
	})

	it("--parser regex uses the injected deps.indexer (no re-wire)", async () => {
		let invocations = 0
		const base = wirePhase0()
		const deps: Phase0Deps = {
			...base,
			indexer: {
				async indexRepository(input) {
					invocations++
					return stubManifest(input)
				},
			},
		}
		const program = buildProgram(deps).exitOverride()
		const spy = vi.spyOn(console, "log").mockImplementation(() => {})
		try {
			await program.parseAsync(
				[
					"index",
					"./fixtures/tiny-ts-lib",
					"--dry-run",
					"--parser",
					"regex",
				],
				{ from: "user" },
			)
		} finally {
			spy.mockRestore()
		}
		expect(invocations).toBe(1)
	})

	it("--parser tree-sitter bypasses the injected deps.indexer (proves re-wire)", async () => {
		let invocations = 0
		const base = wirePhase0()
		const deps: Phase0Deps = {
			...base,
			indexer: {
				async indexRepository(input) {
					invocations++
					return stubManifest(input)
				},
			},
		}
		const program = buildProgram(deps).exitOverride()
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
		const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
		// The re-wired branch creates a fresh real FixtureIndexer that will
		// try to read the sentinel path from disk and throw — we tolerate that
		// failure and only assert that the injected stub indexer was bypassed.
		try {
			await program
				.parseAsync(
					[
						"index",
						"/no/such/codesoul/fixture/path",
						"--dry-run",
						"--parser",
						"tree-sitter",
					],
					{ from: "user" },
				)
				.catch(() => undefined)
		} finally {
			logSpy.mockRestore()
			errSpy.mockRestore()
		}
		expect(invocations).toBe(0)
	})
})

describe("wirePhase0", () => {
	it("defaults to regex parser (MockParser)", () => {
		const deps = wirePhase0()
		expect(deps.config.parser).toBe("regex")
		expect(deps.parser).toBeInstanceOf(MockParser)
	})

	it("accepts an explicit { parser: 'regex' } override", () => {
		const deps = wirePhase0({ parser: "regex" })
		expect(deps.config.parser).toBe("regex")
		expect(deps.parser).toBeInstanceOf(MockParser)
	})

	it("selects TreeSitterParser when parser: 'tree-sitter'", () => {
		const deps = wirePhase0({ parser: "tree-sitter" })
		expect(deps.config.parser).toBe("tree-sitter")
		expect(deps.parser).toBeInstanceOf(TreeSitterParser)
	})

	it("keeps non-parser config fields at their defaults when overriding parser", () => {
		const deps = wirePhase0({ parser: "tree-sitter" })
		expect(deps.config).toMatchObject({
			parser: "tree-sitter",
			graphStore: "memory",
			vectorStore: "memory",
			embedder: "mock",
			reranker: "mock",
			rigExtractors: [],
			enableSpade: false,
		})
	})

	it("end-to-end: tree-sitter wiring parses a Method via FixtureIndexer parser", async () => {
		const deps = wirePhase0({ parser: "tree-sitter" })
		const result = await deps.parser.parseFile({
			repoId: "r",
			indexRunId: "run_test",
			batchId: "batch_test",
			path: "src/farewell.ts",
			language: "typescript",
			source: `export class Farewell {\n\thi(): string { return \"hi\" }\n}\n`,
		})
		const kinds = result.nodes.map((n) => `${n.kind}:${n.qualifiedName}`)
		expect(kinds).toContain("Method:src/farewell.ts::Farewell.hi")
	})
})
