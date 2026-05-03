import { describe, expect, it } from "vitest"
import type {
	Candidate,
	EmbedInput,
	EmbeddingResult,
	GraphEdge,
	GraphNode,
	RankedCandidate,
	VectorRow,
} from "@codesoul/core"
import { EMBEDDING_DIM } from "@codesoul/core"
import { MockEmbedder } from "@codesoul/embedder/mock"
import { MockGraphStore } from "@codesoul/graph-store/mock"
import { MockReranker } from "@codesoul/reranker/mock"
import { MockVectorStore } from "@codesoul/vector-store/mock"
import { retrieve } from "../pipeline.js"

const SYM = (c: string) => `sym_${c.repeat(40)}`
const CNT = (c: string) => `cnt_${c.repeat(40)}`

const meta = {
	repoId: "r",
	indexRunId: "run_t",
	batchId: "batch_t",
	sourcePath: "src/x.ts",
	contentHash: CNT("a"),
	schemaVersion: 1 as const,
}

const node = (id: string, qname: string, path = "src/x.ts"): GraphNode => ({
	...meta,
	id,
	path,
	kind: "Function",
	language: "typescript",
	qualifiedName: qname,
	signature: "",
	evidence: { startLine: 1, endLine: 1 },
})

const edge = (src: string, dst: string): GraphEdge => ({
	...meta,
	src,
	dst,
	type: "CALLS",
})

const row = (id: string, vector: number[]): VectorRow => ({
	...meta,
	nodeId: id,
	embeddingModel: "mock-embedder",
	embeddingRevision: "0",
	embeddingDim: EMBEDDING_DIM,
	vector,
	payloadKind: "FunctionSummary",
})

class RecordingEmbedder extends MockEmbedder {
	inputs: EmbedInput[] = []
	override async embed(
		inputs: ReadonlyArray<EmbedInput>,
	): Promise<EmbeddingResult[]> {
		this.inputs.push(...inputs)
		return super.embed(inputs)
	}
}

class RecordingReranker extends MockReranker {
	received: ReadonlyArray<Candidate> | null = null
	override async rerank(
		query: string,
		candidates: ReadonlyArray<Candidate>,
	): Promise<RankedCandidate[]> {
		this.received = candidates
		return super.rerank(query, candidates)
	}
}

describe("retrieve()", () => {
	it("embeds the query with kind=query and a queryId", async () => {
		const graph = new MockGraphStore()
		const vectors = new MockVectorStore()
		const embedder = new RecordingEmbedder()
		const reranker = new MockReranker()
		await retrieve({ graph, vectors, embedder, reranker }, { query: "greet" })
		expect(embedder.inputs[0]).toMatchObject({
			kind: "query",
			queryId: "default",
			text: "greet",
		})
		expect((embedder.inputs[0] as { nodeId?: string }).nodeId).toBeUndefined()
	})

	it("returns exact lookup hits as snippets", async () => {
		const graph = new MockGraphStore()
		const vectors = new MockVectorStore()
		const embedder = new MockEmbedder()
		const reranker = new MockReranker()
		const greet1 = node(SYM("a"), "src/greet.ts::greet", "src/greet.ts")
		const greet2 = node(SYM("b"), "src/other.ts::greet", "src/other.ts")
		await graph.upsertNodes([greet1, greet2])
		const bundle = await retrieve(
			{ graph, vectors, embedder, reranker },
			{ query: "greet", limit: 5 },
		)
		const paths = bundle.snippets.map((s) => s.path)
		expect(paths).toContain("src/greet.ts")
		expect(paths).toContain("src/other.ts")
		for (const c of bundle.citations) {
			expect(c).toMatch(/^[^:]+:\d+-\d+$/)
		}
	})

	it("includes semantically retrieved nodes", async () => {
		const graph = new MockGraphStore()
		const vectors = new MockVectorStore()
		const embedder = new MockEmbedder()
		const reranker = new MockReranker()
		const foo = node(SYM("a"), "src/foo.ts::foo", "src/foo.ts")
		await graph.upsertNodes([foo])
		const [r] = await embedder.embed([
			{
				kind: "node",
				nodeId: SYM("z"),
				contentHash: CNT("a"),
				payloadKind: "FunctionSummary",
				text: "unrelated",
			},
		])
		await vectors.upsert([row(foo.id, r?.vector ?? new Array(EMBEDDING_DIM).fill(0))])
		const bundle = await retrieve(
			{ graph, vectors, embedder, reranker },
			{ query: "unrelated" },
		)
		const ids = bundle.snippets.map((s) => s.nodeId)
		expect(ids).toContain(foo.id)
	})

	it("expands one hop via the graph store and includes connected nodes", async () => {
		const graph = new MockGraphStore()
		const vectors = new MockVectorStore()
		const embedder = new MockEmbedder()
		const reranker = new MockReranker()
		const a = node(SYM("a"), "src/a.ts::greet", "src/a.ts")
		const b = node(SYM("b"), "src/b.ts::greetHelper", "src/b.ts")
		await graph.upsertNodes([a, b])
		await graph.upsertEdges([edge(a.id, b.id)])
		const bundle = await retrieve(
			{ graph, vectors, embedder, reranker },
			{ query: "greet", limit: 10 },
		)
		const ids = bundle.snippets.map((s) => s.nodeId)
		expect(ids).toContain(a.id)
		expect(ids).toContain(b.id)
	})

	it("sends merged candidates to the reranker, capped at the rerank input limit", async () => {
		const graph = new MockGraphStore()
		const vectors = new MockVectorStore()
		const embedder = new MockEmbedder()
		const reranker = new RecordingReranker()
		await retrieve(
			{ graph, vectors, embedder, reranker },
			{ query: "anything" },
		)
		expect(reranker.received).not.toBeNull()
		expect((reranker.received ?? []).length).toBeLessThanOrEqual(60)
	})

	it("every snippet includes nodeId, path, lines, and a citation", async () => {
		const graph = new MockGraphStore()
		const vectors = new MockVectorStore()
		const embedder = new MockEmbedder()
		const reranker = new MockReranker()
		const a = node(SYM("a"), "src/a.ts::greet", "src/a.ts")
		await graph.upsertNodes([a])
		const bundle = await retrieve(
			{ graph, vectors, embedder, reranker },
			{ query: "greet" },
		)
		expect(bundle.snippets.length).toBeGreaterThan(0)
		for (const s of bundle.snippets) {
			expect(s.nodeId).toBeTruthy()
			expect(s.path).toBeTruthy()
			expect(s.lines).toHaveLength(2)
		}
		expect(bundle.citations.length).toBe(bundle.snippets.length)
	})
})
