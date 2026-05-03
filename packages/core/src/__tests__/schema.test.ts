import { describe, expect, it } from "vitest"
import { EMBEDDING_DIM } from "../constants.js"
import {
	BatchManifest,
	Candidate,
	ContextBundle,
	EmbedInput,
	EmbeddingResult,
	Evidence,
	GraphEdge,
	GraphNode,
	PersistedMeta,
	RigComponent,
	RigGraph,
	VectorRow,
} from "../schema/index.js"
import {
	cntLikeId,
	makeBatchManifest,
	makeCandidate,
	makeGraphEdge,
	makeGraphNode,
	makeMeta,
	makeVectorRow,
	symLikeId,
} from "./builders.js"

describe("PersistedMeta", () => {
	it("accepts a valid meta", () => {
		expect(() => PersistedMeta.parse(makeMeta())).not.toThrow()
	})

	it("rejects a non-cnt content hash", () => {
		expect(() =>
			PersistedMeta.parse(makeMeta({ contentHash: "not-a-hash" })),
		).toThrow()
	})

	it("rejects empty repoId", () => {
		expect(() => PersistedMeta.parse(makeMeta({ repoId: "" }))).toThrow()
	})
})

describe("Evidence", () => {
	it("accepts valid range", () => {
		expect(() => Evidence.parse({ startLine: 1, endLine: 10 })).not.toThrow()
	})

	it("rejects endLine < startLine", () => {
		expect(() => Evidence.parse({ startLine: 10, endLine: 1 })).toThrow()
	})

	it("rejects non-positive lines", () => {
		expect(() => Evidence.parse({ startLine: 0, endLine: 1 })).toThrow()
	})
})

describe("GraphNode", () => {
	it("accepts a valid node", () => {
		expect(() => GraphNode.parse(makeGraphNode())).not.toThrow()
	})

	it("rejects an invalid id", () => {
		expect(() => GraphNode.parse(makeGraphNode({ id: "bad" }))).toThrow()
	})

	it("rejects an unknown kind", () => {
		const bad: unknown = { ...makeGraphNode(), kind: "Bogus" }
		expect(() => GraphNode.parse(bad)).toThrow()
	})
})

describe("GraphEdge", () => {
	it("accepts a valid edge", () => {
		expect(() => GraphEdge.parse(makeGraphEdge())).not.toThrow()
	})

	it("rejects an unknown type", () => {
		const bad: unknown = { ...makeGraphEdge(), type: "BOGUS" }
		expect(() => GraphEdge.parse(bad)).toThrow()
	})

	it("rejects a malformed src", () => {
		expect(() =>
			GraphEdge.parse(makeGraphEdge({ src: "not-a-sym" })),
		).toThrow()
	})
})

describe("VectorRow", () => {
	it("accepts a valid vector row", () => {
		expect(() => VectorRow.parse(makeVectorRow())).not.toThrow()
	})

	it("rejects a vector of wrong length", () => {
		expect(() =>
			VectorRow.parse(
				makeVectorRow({ vector: new Array(EMBEDDING_DIM - 1).fill(0) }),
			),
		).toThrow()
	})
})

describe("BatchManifest", () => {
	it("accepts pending and dry_run", () => {
		expect(() => BatchManifest.parse(makeBatchManifest())).not.toThrow()
		expect(() =>
			BatchManifest.parse(makeBatchManifest({ status: "dry_run" })),
		).not.toThrow()
	})

	it("rejects an invalid sourceContentHash", () => {
		expect(() =>
			BatchManifest.parse(makeBatchManifest({ sourceContentHash: "bad" })),
		).toThrow()
	})

	it("rejects negative counts", () => {
		expect(() =>
			BatchManifest.parse(makeBatchManifest({ nodeCount: -1 })),
		).toThrow()
	})
})

describe("RigGraph", () => {
	it("accepts a minimal graph", () => {
		const g = {
			extractor: "x",
			extractorVersion: "0",
			components: [],
			targets: [],
			tests: [],
			schemaVersion: 1,
		}
		expect(() => RigGraph.parse(g)).not.toThrow()
	})

	it("rejects unknown component kind", () => {
		const c = {
			id: "c",
			name: "n",
			kind: "bogus",
			path: ".",
			dependsOn: [],
		}
		expect(() => RigComponent.parse(c)).toThrow()
	})
})

describe("EmbedInput / EmbeddingResult", () => {
	it("accepts a node-kind input with valid sym/cnt ids", () => {
		expect(() =>
			EmbedInput.parse({
				kind: "node",
				nodeId: symLikeId("a"),
				contentHash: cntLikeId("a"),
				payloadKind: "FunctionSummary",
				text: "hello",
			}),
		).not.toThrow()
	})

	it("accepts a query-kind input", () => {
		expect(() =>
			EmbedInput.parse({
				kind: "query",
				queryId: "q1",
				text: "greet",
			}),
		).not.toThrow()
	})

	it("rejects a node input with malformed nodeId", () => {
		expect(() =>
			EmbedInput.parse({
				kind: "node",
				nodeId: "x",
				contentHash: cntLikeId("a"),
				payloadKind: "FunctionSummary",
				text: "hello",
			}),
		).toThrow()
	})

	it("rejects a node input without kind", () => {
		expect(() =>
			EmbedInput.parse({
				nodeId: symLikeId("a"),
				contentHash: cntLikeId("a"),
				payloadKind: "FunctionSummary",
				text: "hello",
			}),
		).toThrow()
	})

	it("rejects unknown payloadKind on node input", () => {
		expect(() =>
			EmbedInput.parse({
				kind: "node",
				nodeId: symLikeId("a"),
				contentHash: cntLikeId("a"),
				payloadKind: "Bogus",
				text: "hello",
			}),
		).toThrow()
	})

	it("validates EmbeddingResult vector length", () => {
		expect(() =>
			EmbeddingResult.parse({
				inputKind: "node",
				nodeId: symLikeId("a"),
				vector: new Array(EMBEDDING_DIM - 1).fill(0),
				embeddingModel: "m",
				embeddingRevision: "0",
				embeddingDim: EMBEDDING_DIM,
			}),
		).toThrow()
	})

	it("accepts an EmbeddingResult for a query input", () => {
		expect(() =>
			EmbeddingResult.parse({
				inputKind: "query",
				queryId: "q1",
				vector: new Array(EMBEDDING_DIM).fill(0),
				embeddingModel: "m",
				embeddingRevision: "0",
				embeddingDim: EMBEDDING_DIM,
			}),
		).not.toThrow()
	})
})

describe("Candidate / ContextBundle", () => {
	it("accepts a valid candidate", () => {
		expect(() => Candidate.parse(makeCandidate())).not.toThrow()
	})

	it("rejects an unknown source", () => {
		const bad: unknown = { ...makeCandidate(), source: "bogus" }
		expect(() => Candidate.parse(bad)).toThrow()
	})

	it("accepts an empty ContextBundle", () => {
		expect(() =>
			ContextBundle.parse({
				query: "",
				snippets: [],
				citations: [],
				tokenBudget: { total: 0, used: 0 },
			}),
		).not.toThrow()
	})
})
