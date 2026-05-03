import { EMBEDDING_DIM } from "../constants.js"
import type {
	BatchManifest,
	Candidate,
	Evidence,
	GraphEdge,
	GraphNode,
	PersistedMeta,
	VectorRow,
} from "../schema/index.js"

const symLike = (char = "a"): string => `sym_${char.repeat(40)}`
const cntLike = (char = "a"): string => `cnt_${char.repeat(40)}`

export const symLikeId = symLike
export const cntLikeId = cntLike

export const makeMeta = (
	overrides: Partial<PersistedMeta> = {},
): PersistedMeta => ({
	repoId: "repo_test",
	indexRunId: "run_test",
	batchId: "batch_test",
	sourcePath: "src/foo.ts",
	contentHash: cntLike("a"),
	schemaVersion: 1,
	...overrides,
})

export const makeEvidence = (
	overrides: Partial<Evidence> = {},
): Evidence => ({
	startLine: 1,
	endLine: 10,
	...overrides,
})

export const makeGraphNode = (
	overrides: Partial<GraphNode> = {},
): GraphNode => ({
	...makeMeta(),
	id: symLike("a"),
	path: "src/foo.ts",
	kind: "Function",
	language: "typescript",
	qualifiedName: "src/foo.ts::foo",
	signature: "foo()",
	evidence: makeEvidence(),
	...overrides,
})

export const makeGraphEdge = (
	overrides: Partial<GraphEdge> = {},
): GraphEdge => ({
	...makeMeta(),
	src: symLike("a"),
	dst: symLike("b"),
	type: "CONTAINS",
	...overrides,
})

export const makeVectorRow = (
	overrides: Partial<VectorRow> = {},
): VectorRow => ({
	...makeMeta(),
	nodeId: symLike("a"),
	embeddingModel: "mock-embedder",
	embeddingRevision: "0",
	embeddingDim: EMBEDDING_DIM,
	vector: new Array(EMBEDDING_DIM).fill(0),
	payloadKind: "FunctionSummary",
	...overrides,
})

export const makeBatchManifest = (
	overrides: Partial<BatchManifest> = {},
): BatchManifest => ({
	batchId: "batch_test",
	indexRunId: "run_test",
	repoId: "repo_test",
	sourcePath: "/repo",
	sourceContentHash: cntLike("a"),
	status: "pending",
	nodeCount: 0,
	edgeCount: 0,
	vectorCount: 0,
	createdAt: "2026-01-01T00:00:00.000Z",
	committedAt: null,
	checksum: "x",
	schemaVersion: 1,
	...overrides,
})

export const makeCandidate = (
	overrides: Partial<Candidate> = {},
): Candidate => ({
	nodeId: symLike("a"),
	source: "exact",
	score: 1,
	evidencePath: "src/foo.ts",
	evidenceLines: [1, 10],
	...overrides,
})
