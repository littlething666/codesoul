import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import type { GraphEdge, GraphNode } from "@codesoul/core"
import { MockEmbedder } from "@codesoul/embedder/mock"
import type {
	GraphQueryResult,
	GraphStore,
	ListEdgesOptions,
	ListNodesOptions,
	TraversalOptions,
} from "@codesoul/graph-store"
import { MockGraphStore } from "@codesoul/graph-store/mock"
import { InMemoryManifestStore } from "@codesoul/manifest-store/memory"
import { MockParser } from "@codesoul/parser/mock"
import { MockRigExtractor } from "@codesoul/rig/mock"
import { MockVectorStore } from "@codesoul/vector-store/mock"
import { FixtureIndexer } from "../mock-fixture.js"
import type { IdGen } from "../idgen.js"
import type { Clock } from "../time.js"

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(here, "../../../../fixtures/tiny-ts-lib")

const makeRig = (
	extra: {
		clock?: Clock
		idGen?: IdGen
		manifestStore?: InMemoryManifestStore
	} = {},
) => {
	const parser = new MockParser()
	const rig = new MockRigExtractor()
	const graph = new MockGraphStore()
	const vectors = new MockVectorStore()
	const embedder = new MockEmbedder()
	const indexer = new FixtureIndexer({
		parser,
		rig,
		graph,
		vectors,
		embedder,
		...extra,
	})
	return { parser, rig, graph, vectors, embedder, indexer }
}

class ThrowingGraphStore implements GraphStore {
	async upsertNodes(_nodes: ReadonlyArray<GraphNode>): Promise<void> {
		throw new Error("boom")
	}
	async upsertEdges(_edges: ReadonlyArray<GraphEdge>): Promise<void> {}
	async getNode(_id: string): Promise<GraphNode | null> {
		return null
	}
	async neighbors(
		_id: string,
		_options: TraversalOptions,
	): Promise<GraphQueryResult> {
		return { nodes: [], edges: [] }
	}
	async findByQualifiedName(_name: string): Promise<GraphNode[]> {
		return []
	}
	async listNodes(_options?: ListNodesOptions): Promise<GraphNode[]> {
		return []
	}
	async listEdges(_options?: ListEdgesOptions): Promise<GraphEdge[]> {
		return []
	}
	async health(): Promise<{ ok: boolean; details?: string }> {
		return { ok: true }
	}
}

describe("phase 0 smoke pipeline", () => {
	it("indexes the tiny-ts-lib fixture end-to-end with mocks", async () => {
		const { graph, vectors, indexer } = makeRig()
		const result = await indexer.indexRepository({
			repoPath: FIXTURE,
			repoId: "repo_fixture",
			indexRunId: "run_phase0",
		})
		expect(result.manifest.status).toBe("committed")
		expect(result.nodeCount).toBeGreaterThan(0)
		expect(result.edgeCount).toBeGreaterThan(0)
		expect(await vectors.countByRun("run_phase0")).toBeGreaterThan(0)
		const greetMatches = await graph.findByQualifiedName("greet")
		expect(greetMatches.length).toBeGreaterThan(0)
		const farewellMatches = await graph.findByQualifiedName("Farewell")
		expect(farewellMatches.length).toBeGreaterThan(0)
	})

	it("is idempotent on a second run with identical inputs", async () => {
		const { indexer } = makeRig()
		const a = await indexer.indexRepository({
			repoPath: FIXTURE,
			repoId: "repo_fixture",
			indexRunId: "run_phase0",
		})
		const b = await indexer.indexRepository({
			repoPath: FIXTURE,
			repoId: "repo_fixture",
			indexRunId: "run_phase0",
		})
		expect(b.nodeCount).toBe(a.nodeCount)
		expect(b.edgeCount).toBe(a.edgeCount)
		expect(b.vectorCount).toBe(a.vectorCount)
	})

	it("is byte-identical with injected Clock and IdGen", async () => {
		const FIXED = "2026-01-01T00:00:00.000Z"
		const clock: Clock = { nowIso: () => FIXED }
		const idGen: IdGen = { batchId: () => "batch_test" }
		const a = await makeRig({ clock, idGen }).indexer.indexRepository({
			repoPath: FIXTURE,
			repoId: "repo_fixture",
			indexRunId: "run_phase0",
		})
		const b = await makeRig({ clock, idGen }).indexer.indexRepository({
			repoPath: FIXTURE,
			repoId: "repo_fixture",
			indexRunId: "run_phase0",
		})
		expect(a.manifest).toEqual(b.manifest)
		expect(a.manifest.batchId).toBe("batch_test")
		expect(a.manifest.createdAt).toBe(FIXED)
		expect(a.manifest.committedAt).toBe(FIXED)
	})

	it("dryRun produces a dry_run manifest and does not persist", async () => {
		const { graph, vectors, indexer } = makeRig()
		const result = await indexer.indexRepository({
			repoPath: FIXTURE,
			repoId: "repo_fixture",
			indexRunId: "run_dry",
			dryRun: true,
		})
		expect(result.manifest.status).toBe("dry_run")
		expect(result.manifest.committedAt).toBeNull()
		expect(await vectors.countByRun("run_dry")).toBe(0)
		expect(await graph.findByQualifiedName("greet")).toHaveLength(0)
	})

	it("records pending then transitions to committed via the manifest store", async () => {
		const FIXED = "2026-01-01T00:00:00.000Z"
		const clock: Clock = { nowIso: () => FIXED }
		const idGen: IdGen = { batchId: () => "batch_committed" }
		const manifestStore = new InMemoryManifestStore({ clock })
		const { indexer } = makeRig({ clock, idGen, manifestStore })
		await indexer.indexRepository({
			repoPath: FIXTURE,
			repoId: "repo_fixture",
			indexRunId: "run_committed",
		})
		const events = await manifestStore.listEvents("batch_committed")
		expect(events.map((e) => e.toStatus)).toEqual(["pending", "committed"])
		expect(events[0]?.fromStatus).toBeNull()
		expect(events[1]?.fromStatus).toBe("pending")
		const stored = await manifestStore.getBatch("batch_committed")
		expect(stored?.status).toBe("committed")
		expect(stored?.committedAt).toBe(FIXED)
	})

	it("dryRun records pending then transitions to dry_run", async () => {
		const FIXED = "2026-01-01T00:00:00.000Z"
		const clock: Clock = { nowIso: () => FIXED }
		const idGen: IdGen = { batchId: () => "batch_dry" }
		const manifestStore = new InMemoryManifestStore({ clock })
		const { indexer } = makeRig({ clock, idGen, manifestStore })
		await indexer.indexRepository({
			repoPath: FIXTURE,
			repoId: "repo_fixture",
			indexRunId: "run_dry_2",
			dryRun: true,
		})
		const events = await manifestStore.listEvents("batch_dry")
		expect(events.map((e) => e.toStatus)).toEqual(["pending", "dry_run"])
		const stored = await manifestStore.getBatch("batch_dry")
		expect(stored?.status).toBe("dry_run")
		expect(stored?.committedAt).toBeNull()
	})

	it("transitions the batch to failed when persistence throws", async () => {
		const FIXED = "2026-01-01T00:00:00.000Z"
		const clock: Clock = { nowIso: () => FIXED }
		const idGen: IdGen = { batchId: () => "batch_fail" }
		const manifestStore = new InMemoryManifestStore({ clock })
		const indexer = new FixtureIndexer({
			parser: new MockParser(),
			rig: new MockRigExtractor(),
			graph: new ThrowingGraphStore(),
			vectors: new MockVectorStore(),
			embedder: new MockEmbedder(),
			clock,
			idGen,
			manifestStore,
		})
		await expect(
			indexer.indexRepository({
				repoPath: FIXTURE,
				repoId: "repo_fixture",
				indexRunId: "run_fail",
			}),
		).rejects.toThrow("boom")
		const stored = await manifestStore.getBatch("batch_fail")
		expect(stored?.status).toBe("failed")
		expect(stored?.committedAt).toBeNull()
		const events = await manifestStore.listEvents("batch_fail")
		expect(events.map((e) => e.toStatus)).toEqual(["pending", "failed"])
		expect(events[1]?.message).toBe("boom")
	})
})
