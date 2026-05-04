import { describe, expect, it, vi } from "vitest"
import type { IndexRepositoryResult } from "@codesoul/indexer"
import { MockParser } from "@codesoul/parser/mock"
import { TreeSitterParser } from "@codesoul/parser/tree-sitter"
import { RigDispatcher } from "@codesoul/rig/dispatcher"
import { MockRigExtractor } from "@codesoul/rig/mock"
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
}): IndexRepositoryResult => ({
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

	it("rejects unknown --rig-extractors entries", async () => {
		const deps = makeDeps()
		const program = buildProgram(deps).exitOverride()
		await expect(
			program.parseAsync(
				[
					"index",
					"./fixtures/tiny-ts-lib",
					"--dry-run",
					"--rig-extractors",
					"package-json,bogus",
				],
				{ from: "user" },
			),
		).rejects.toBeInstanceOf(Error)
	})

	it("--rig-extractors '' uses the injected deps.indexer (no re-wire)", async () => {
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
					"--rig-extractors",
					"",
				],
				{ from: "user" },
			)
		} finally {
			spy.mockRestore()
		}
		expect(invocations).toBe(1)
	})

	it("--rig-extractors package-json bypasses the injected deps.indexer (proves re-wire)", async () => {
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
		try {
			await program
				.parseAsync(
					[
						"index",
						"/no/such/codesoul/fixture/path",
						"--dry-run",
						"--rig-extractors",
						"package-json",
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

	it("rejects unknown --embedder modes", async () => {
		const deps = makeDeps()
		const program = buildProgram(deps).exitOverride()
		await expect(
			program.parseAsync(
				[
					"index",
					"./fixtures/tiny-ts-lib",
					"--dry-run",
					"--embedder",
					"bogus",
				],
				{ from: "user" },
			),
		).rejects.toBeInstanceOf(Error)
	})

	it("rejects unknown --reranker modes", async () => {
		const deps = makeDeps()
		const program = buildProgram(deps).exitOverride()
		await expect(
			program.parseAsync(
				[
					"index",
					"./fixtures/tiny-ts-lib",
					"--dry-run",
					"--reranker",
					"bogus",
				],
				{ from: "user" },
			),
		).rejects.toBeInstanceOf(Error)
	})

	it("rejects unknown --vector-store modes", async () => {
		const deps = makeDeps()
		const program = buildProgram(deps).exitOverride()
		await expect(
			program.parseAsync(
				[
					"index",
					"./fixtures/tiny-ts-lib",
					"--dry-run",
					"--vector-store",
					"bogus",
				],
				{ from: "user" },
			),
		).rejects.toBeInstanceOf(Error)
	})

	it("rejects unknown --graph-store modes", async () => {
		const deps = makeDeps()
		const program = buildProgram(deps).exitOverride()
		await expect(
			program.parseAsync(
				[
					"index",
					"./fixtures/tiny-ts-lib",
					"--dry-run",
					"--graph-store",
					"bogus",
				],
				{ from: "user" },
			),
		).rejects.toBeInstanceOf(Error)
	})

	it("--embedder mock uses the injected deps.indexer (no re-wire)", async () => {
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
					"--embedder",
					"mock",
				],
				{ from: "user" },
			)
		} finally {
			spy.mockRestore()
		}
		expect(invocations).toBe(1)
	})

	it("--reranker mock uses the injected deps.indexer (no re-wire)", async () => {
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
					"--reranker",
					"mock",
				],
				{ from: "user" },
			)
		} finally {
			spy.mockRestore()
		}
		expect(invocations).toBe(1)
	})

	it("--vector-store memory uses the injected deps.indexer (no re-wire)", async () => {
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
					"--vector-store",
					"memory",
				],
				{ from: "user" },
			)
		} finally {
			spy.mockRestore()
		}
		expect(invocations).toBe(1)
	})

	it("--graph-store memory uses the injected deps.indexer (no re-wire)", async () => {
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
					"--graph-store",
					"memory",
				],
				{ from: "user" },
			)
		} finally {
			spy.mockRestore()
		}
		expect(invocations).toBe(1)
	})

	it("--embedder http triggers a re-wire (which then fails fast on missing env vars)", async () => {
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
		// Snapshot env so the test stays hermetic regardless of the dev box.
		const snapshot = {
			url: process.env.CODESOUL_EMBEDDER_URL,
			model: process.env.CODESOUL_EMBEDDER_MODEL,
			rev: process.env.CODESOUL_EMBEDDER_REVISION,
		}
		delete process.env.CODESOUL_EMBEDDER_URL
		delete process.env.CODESOUL_EMBEDDER_MODEL
		delete process.env.CODESOUL_EMBEDDER_REVISION
		try {
			await program
				.parseAsync(
					[
						"index",
						"./fixtures/tiny-ts-lib",
						"--dry-run",
						"--embedder",
						"http",
					],
					{ from: "user" },
				)
				.catch(() => undefined)
		} finally {
			if (snapshot.url) process.env.CODESOUL_EMBEDDER_URL = snapshot.url
			if (snapshot.model) process.env.CODESOUL_EMBEDDER_MODEL = snapshot.model
			if (snapshot.rev) process.env.CODESOUL_EMBEDDER_REVISION = snapshot.rev
			logSpy.mockRestore()
			errSpy.mockRestore()
		}
		expect(invocations).toBe(0)
	})

	it("--vector-store lancedb triggers a re-wire (which then fails fast on missing env var)", async () => {
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
		const snapshot = {
			uri: process.env.CODESOUL_VECTOR_STORE_URI,
		}
		delete process.env.CODESOUL_VECTOR_STORE_URI
		try {
			await program
				.parseAsync(
					[
						"index",
						"./fixtures/tiny-ts-lib",
						"--dry-run",
						"--vector-store",
						"lancedb",
					],
					{ from: "user" },
				)
				.catch(() => undefined)
		} finally {
			if (snapshot.uri)
				process.env.CODESOUL_VECTOR_STORE_URI = snapshot.uri
			logSpy.mockRestore()
			errSpy.mockRestore()
		}
		expect(invocations).toBe(0)
	})

	it("--graph-store neo4j triggers a re-wire (which then fails fast on missing env vars)", async () => {
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
		const snapshot = {
			url: process.env.CODESOUL_NEO4J_URL,
			user: process.env.CODESOUL_NEO4J_USER,
			password: process.env.CODESOUL_NEO4J_PASSWORD,
		}
		delete process.env.CODESOUL_NEO4J_URL
		delete process.env.CODESOUL_NEO4J_USER
		delete process.env.CODESOUL_NEO4J_PASSWORD
		try {
			await program
				.parseAsync(
					[
						"index",
						"./fixtures/tiny-ts-lib",
						"--dry-run",
						"--graph-store",
						"neo4j",
					],
					{ from: "user" },
				)
				.catch(() => undefined)
		} finally {
			if (snapshot.url) process.env.CODESOUL_NEO4J_URL = snapshot.url
			if (snapshot.user) process.env.CODESOUL_NEO4J_USER = snapshot.user
			if (snapshot.password)
				process.env.CODESOUL_NEO4J_PASSWORD = snapshot.password
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

	it("defaults rig to MockRigExtractor when rigExtractors is empty", () => {
		const deps = wirePhase0()
		expect(deps.config.rigExtractors).toEqual([])
		expect(deps.rig).toBeInstanceOf(MockRigExtractor)
	})

	it("selects RigDispatcher when rigExtractors is non-empty", () => {
		const deps = wirePhase0({
			rigExtractors: ["package-json", "pyproject"],
		})
		expect(deps.config.rigExtractors).toEqual([
			"package-json",
			"pyproject",
		])
		expect(deps.rig).toBeInstanceOf(RigDispatcher)
	})

	it("selects RigDispatcher when only spade is configured (Phase 7d)", () => {
		const deps = wirePhase0({ rigExtractors: ["spade"] })
		expect(deps.rig).toBeInstanceOf(RigDispatcher)
	})
})
