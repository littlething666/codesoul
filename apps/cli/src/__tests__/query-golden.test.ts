import { describe, expect, it, vi } from "vitest"
import { readFile } from "node:fs/promises"
import { join } from "node:path"
import type { GraphEdge, GraphNode, VectorRow } from "@codesoul/core"
import {
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
	SCHEMA_VERSION,
	contentId,
	edgeContentHash,
	normalizeBody,
	normalizeSignature,
	stableId,
} from "@codesoul/core"
import { MockEmbedder } from "@codesoul/embedder/mock"
import { MockGraphStore } from "@codesoul/graph-store/mock"
import { MockReranker } from "@codesoul/reranker/mock"
import { MockVectorStore } from "@codesoul/vector-store/mock"
import { FileSystemSourceProvider } from "@codesoul/core"
import { retrieve } from "@codesoul/retrieval"
import { TreeSitterParser } from "@codesoul/parser/tree-sitter"
import { buildProgram } from "../program.js"
import { wireRuntime } from "../wiring.js"

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
		const deps = wireRuntime()
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
		const deps = wireRuntime()
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
		const deps = wireRuntime()
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
		const deps = wireRuntime()
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

describe("codesoul query golden (seeded tiny-ts-lib)", () => {
	/**
	 * Parse the tiny-ts-lib fixture with TreeSitterParser, seed the resulting
	 * nodes/edges into a MockGraphStore and embed with MockEmbedder into a
	 * MockVectorStore, then verify architecture queries return expected results.
	 */
	const seedFixture = async (): Promise<{
		graph: MockGraphStore
		vectors: MockVectorStore
		sourceProvider: FileSystemSourceProvider
	}> => {
		// Resolve from the workspace root (vitest runs from the package dir).
		const repoPath = join(process.cwd(), "../../fixtures/tiny-ts-lib")
		const repoId = "repo_tiny"
		const indexRunId = "run_golden"
		const batchId = "batch_golden"

		const files = [
			{ path: "src/greet.ts", language: "typescript" as const },
			{ path: "src/farewell.ts", language: "typescript" as const },
		]

		const parser = new TreeSitterParser()
		const graph = new MockGraphStore()
		const vectors = new MockVectorStore()
		const embedder = new MockEmbedder()
		const sourceProvider = new FileSystemSourceProvider(repoPath)

		const allNodes: GraphNode[] = []
		const allEdges: GraphEdge[] = []

		for (const f of files) {
			const source = await readFile(join(repoPath, f.path), "utf8")
			const result = await parser.parseFile({
				repoId,
				indexRunId,
				batchId,
				path: f.path,
				language: f.language,
				source,
			})
			allNodes.push(...result.nodes)
			allEdges.push(...result.edges)

			// Embed Function/Method nodes
			for (const n of result.nodes) {
				if (
					n.kind === "Function" ||
					n.kind === "Method" ||
					n.kind === "Class"
				) {
					const [emb] = await embedder.embed([
						{
							kind: "node",
							nodeId: n.id,
							contentHash: n.contentHash,
							payloadKind: "FunctionSummary",
							text: `${n.qualifiedName}\n${n.signature}`,
						},
					])
					if (emb) {
						await vectors.upsert([
							{
								nodeId: n.id,
								embeddingModel: emb.embeddingModel,
								embeddingRevision: emb.embeddingRevision,
								embeddingDim: emb.embeddingDim,
								vector: emb.vector,
								payloadKind: "FunctionSummary",
								repoId,
								indexRunId,
								batchId,
								sourcePath: n.path,
								contentHash: n.contentHash,
								schemaVersion: SCHEMA_VERSION,
							},
						])
					}
				}
			}
		}

		await graph.upsertNodes(allNodes)
		await graph.upsertEdges(allEdges)

		return { graph, vectors, sourceProvider }
	}

	it("'greet' exact lookup finds the greet Function node", async () => {
		const { graph, vectors, sourceProvider } = await seedFixture()
		const reranker = new MockReranker()

		const bundle = await retrieve(
			{ graph, vectors, embedder: new MockEmbedder(), reranker, sourceProvider },
			{ query: "greet", limit: 10 },
		)

		// We expect at least one snippet pointing to src/greet.ts
		expect(bundle.snippets.length).toBeGreaterThan(0)
		const greetSnippets = bundle.snippets.filter((s) =>
			s.path.includes("greet.ts"),
		)
		expect(greetSnippets.length).toBeGreaterThan(0)
	})

	it("'what calls greet' finds greetMany via exact lookup on greet", async () => {
		const { graph, vectors, sourceProvider } = await seedFixture()
		const reranker = new MockReranker()

		const bundle = await retrieve(
			{ graph, vectors, embedder: new MockEmbedder(), reranker, sourceProvider },
			{ query: "what calls greet", limit: 10 },
		)

		// greet exact match + graph expansion should surface greetMany.
		// The retrieval pipeline finds "greet" as exact lookup, then
		// expands neighbors (1 hop) which should include greetMany via CALLS edge.
		const nodeIds = bundle.snippets.map((s) => s.nodeId)

		// Find the greetMany node
		const greetManyNode = (
			await graph.listNodes({ pathPrefix: "src/greet.ts" })
		).find((n) => n.qualifiedName.includes("greetMany"))

		if (greetManyNode) {
			// greetMany should appear in snippets or at least one of
			// greet's callers (greetMany) should be reachable via graph expansion.
			const hasGreetMany = nodeIds.includes(greetManyNode.id)
			expect(hasGreetMany).toBe(true)
		}
	})

	it("'where is greet defined' returns src/greet.ts", async () => {
		const { graph, vectors, sourceProvider } = await seedFixture()
		const reranker = new MockReranker()

		const bundle = await retrieve(
			{ graph, vectors, embedder: new MockEmbedder(), reranker, sourceProvider },
			{ query: "where is greet defined", limit: 10 },
		)

		// Exact lookup on "greet" should find the greet function.
		const greetPath = bundle.snippets.find((s) =>
			s.path.includes("greet.ts"),
		)
		expect(greetPath).toBeDefined()
		expect(greetPath!.path).toBe("src/greet.ts")
	})

	it("graph export returns non-empty nodes and edges after seeding", async () => {
		const { graph } = await seedFixture()

		const nodes = await graph.listNodes()
		const edges = await graph.listEdges()

		expect(nodes.length).toBeGreaterThan(0)
		expect(edges.length).toBeGreaterThan(0)

		// Verify we can deterministically sort (as graph-export.ts does).
		const sortedNodes = [...nodes].sort((a, b) => a.id.localeCompare(b.id))
		expect(sortedNodes.length).toBe(nodes.length)
		for (let i = 1; i < sortedNodes.length; i++) {
			expect(sortedNodes[i]!.id.localeCompare(sortedNodes[i - 1]!.id)).toBeGreaterThanOrEqual(0)
		}

		const sortedEdges = [...edges].sort((a, b) => {
			const cmpSrc = a.src.localeCompare(b.src)
			if (cmpSrc !== 0) return cmpSrc
			const cmpType = a.type.localeCompare(b.type)
			if (cmpType !== 0) return cmpType
			return a.dst.localeCompare(b.dst)
		})
		expect(sortedEdges.length).toBe(edges.length)
		for (let i = 1; i < sortedEdges.length; i++) {
			const prev = sortedEdges[i - 1]!
			const curr = sortedEdges[i]!
			const cmpSrc = prev.src.localeCompare(curr.src)
			if (cmpSrc !== 0) {
				expect(cmpSrc).toBeLessThan(0)
			} else {
				const cmpType = prev.type.localeCompare(curr.type)
				if (cmpType !== 0) {
					expect(cmpType).toBeLessThan(0)
				} else {
					expect(prev.dst.localeCompare(curr.dst)).toBeLessThanOrEqual(0)
				}
			}
		}
	})
})
