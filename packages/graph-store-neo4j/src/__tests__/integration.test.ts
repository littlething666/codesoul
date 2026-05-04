import { afterAll, beforeAll, describe, expect, it } from "vitest"
import type { GraphEdge, GraphNode } from "@codesoul/core"
import { Neo4jGraphStore } from "../neo4j-store.js"

// Integration tests run only when an explicit Bolt URL is supplied.
// Without it, the suite skips silently so `pnpm -r test` stays green on
// dev machines and PR CI without Neo4j wired in. To run these locally:
//
//   docker compose up -d --wait neo4j
//   NEO4J_INTEGRATION_URL=bolt://localhost:7687 \
//   NEO4J_INTEGRATION_USER=neo4j \
//   NEO4J_INTEGRATION_PASSWORD=password \
//   pnpm --filter @codesoul/graph-store-neo4j test
//
// Or use the convenience script:
//
//   ./scripts/test-neo4j-integration.sh

const NEO4J_URL = process.env.NEO4J_INTEGRATION_URL
const NEO4J_USER = process.env.NEO4J_INTEGRATION_USER ?? "neo4j"
const NEO4J_PASS = process.env.NEO4J_INTEGRATION_PASSWORD ?? "password"
const NEO4J_DB = process.env.NEO4J_INTEGRATION_DATABASE ?? "neo4j"

const describeIntegration = NEO4J_URL ? describe : describe.skip

// `GraphNode.id` is `sym_<40 hex chars>`. Build ids from a numeric index so
// every test gets a unique, schema-valid id without having to hand-pick hex
// characters per case.
const SYM = (i: number) => `sym_${i.toString(16).padStart(40, "0")}`
const CNT = (c: string) => `cnt_${c.repeat(40)}`

// Each test run uses a unique repoId so concurrent / repeated runs do
// not see each other's data without dropping the database.
const REPO_ID = `r_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

const meta = {
	repoId: REPO_ID,
	indexRunId: "run_int",
	batchId: "batch_int",
	sourcePath: "src/x.ts",
	contentHash: CNT("a"),
	schemaVersion: 1 as const,
}

const node = (
	id: string,
	qname: string,
	path = "src/x.ts",
	overrides: Partial<GraphNode> = {},
): GraphNode => ({
	...meta,
	id,
	path,
	kind: "Function",
	language: "typescript",
	qualifiedName: qname,
	signature: "",
	evidence: { startLine: 1, endLine: 1 },
	...overrides,
})

const edge = (src: string, dst: string): GraphEdge => ({
	...meta,
	src,
	dst,
	type: "CALLS",
})

describeIntegration("Neo4jGraphStore (integration)", () => {
	let store: Neo4jGraphStore

	beforeAll(async () => {
		if (!NEO4J_URL) return
		store = new Neo4jGraphStore({
			uri: NEO4J_URL,
			username: NEO4J_USER,
			password: NEO4J_PASS,
			database: NEO4J_DB,
		})
		await store.runMigrations()
	}, 60_000)

	afterAll(async () => {
		if (store) await store.close()
	})

	it("upserts and retrieves a node", async () => {
		const a = node(SYM(1), "src/x.ts::greet")
		await store.upsertNodes([a])
		expect(await store.getNode(a.id)).toEqual(a)
	})

	it("is idempotent on duplicate node upserts", async () => {
		const a = node(SYM(2), "src/x.ts::greet2")
		await store.upsertNodes([a, a])
		expect(await store.getNode(a.id)).toEqual(a)
	})

	it("upserts and traverses out-edges", async () => {
		const a = node(SYM(3), "a")
		const b = node(SYM(4), "b")
		await store.upsertNodes([a, b])
		await store.upsertEdges([edge(a.id, b.id)])
		const result = await store.neighbors(a.id, {
			depth: 1,
			direction: "out",
		})
		const ids = new Set(result.nodes.map((n) => n.id))
		expect(ids.has(a.id)).toBe(true)
		expect(ids.has(b.id)).toBe(true)
		expect(result.edges.length).toBe(1)
	})

	it("in direction returns parents", async () => {
		const a = node(SYM(5), "d")
		const b = node(SYM(6), "e")
		await store.upsertNodes([a, b])
		await store.upsertEdges([edge(a.id, b.id)])
		const result = await store.neighbors(b.id, {
			depth: 1,
			direction: "in",
		})
		const ids = new Set(result.nodes.map((n) => n.id))
		expect(ids.has(a.id)).toBe(true)
	})

	it("edgeTypes filters traversal", async () => {
		const a = node(SYM(7), "f")
		const b = node(SYM(8), "g")
		await store.upsertNodes([a, b])
		await store.upsertEdges([{ ...edge(a.id, b.id), type: "IMPORTS" }])
		const calls = await store.neighbors(a.id, {
			depth: 1,
			edgeTypes: ["CALLS"],
		})
		expect(calls.nodes.map((n) => n.id)).toEqual([a.id])
		const imports = await store.neighbors(a.id, {
			depth: 1,
			edgeTypes: ["IMPORTS"],
		})
		const ids = new Set(imports.nodes.map((n) => n.id))
		expect(ids.has(b.id)).toBe(true)
	})

	it("findByQualifiedName supports exact and suffix match", async () => {
		const a = node(SYM(9), "src/greet.ts::greet")
		await store.upsertNodes([a])
		const exact = await store.findByQualifiedName("src/greet.ts::greet")
		expect(exact.some((n) => n.id === a.id)).toBe(true)
		const suffix = await store.findByQualifiedName("greet")
		expect(suffix.some((n) => n.id === a.id)).toBe(true)
	})

	it("listNodes filters by kind, path prefix, and repoId", async () => {
		const a = node(SYM(10), "i", "src/foo/x.ts")
		const b = node(SYM(11), "j", "src/bar/y.ts", { kind: "Class" })
		await store.upsertNodes([a, b])
		const foo = await store.listNodes({
			pathPrefix: "src/foo/",
			repoId: REPO_ID,
		})
		const fooIds = new Set(foo.map((n) => n.id))
		expect(fooIds.has(a.id)).toBe(true)
		expect(fooIds.has(b.id)).toBe(false)
		const classes = await store.listNodes({
			kind: "Class",
			repoId: REPO_ID,
		})
		expect(classes.some((n) => n.id === b.id)).toBe(true)
	})

	it("listEdges filters by type and repoId", async () => {
		const a = node(SYM(12), "k")
		const b = node(SYM(13), "l")
		await store.upsertNodes([a, b])
		await store.upsertEdges([{ ...edge(a.id, b.id), type: "IMPORTS" }])
		const imports = await store.listEdges({
			type: "IMPORTS",
			repoId: REPO_ID,
		})
		expect(
			imports.some((e) => e.src === a.id && e.dst === b.id),
		).toBe(true)
	})

	it("health returns ok against a live database", async () => {
		expect((await store.health()).ok).toBe(true)
	})
})
