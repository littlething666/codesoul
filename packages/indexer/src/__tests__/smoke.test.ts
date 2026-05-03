import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { MockEmbedder } from "@codesoul/embedder/mock"
import { MockGraphStore } from "@codesoul/graph-store/mock"
import { MockParser } from "@codesoul/parser/mock"
import { MockRigExtractor } from "@codesoul/rig/mock"
import { MockVectorStore } from "@codesoul/vector-store/mock"
import { FixtureIndexer } from "../mock-fixture.js"

const here = dirname(fileURLToPath(import.meta.url))
const FIXTURE = resolve(here, "../../../../fixtures/tiny-ts-lib")

const makeRig = () => {
	const parser = new MockParser()
	const rig = new MockRigExtractor()
	const graph = new MockGraphStore()
	const vectors = new MockVectorStore()
	const embedder = new MockEmbedder()
	const indexer = new FixtureIndexer({ parser, rig, graph, vectors, embedder })
	return { parser, rig, graph, vectors, embedder, indexer }
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
})
