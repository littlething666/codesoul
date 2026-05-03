import { z } from "zod"
import { EMBEDDING_DIM } from "../constants.js"

const symId = z.string().regex(/^sym_[0-9a-f]{40}$/)
const contentHash = z.string().regex(/^cnt_[0-9a-f]{40}$/)

export const EmbedNodeInput = z.object({
	kind: z.literal("node"),
	nodeId: symId,
	contentHash,
	payloadKind: z.enum(["FunctionSummary", "Block", "Markdown"]),
	text: z.string(),
})
export type EmbedNodeInput = z.infer<typeof EmbedNodeInput>

export const EmbedQueryInput = z.object({
	kind: z.literal("query"),
	queryId: z.string().min(1),
	text: z.string(),
})
export type EmbedQueryInput = z.infer<typeof EmbedQueryInput>

/**
 * Discriminated union over `kind`.
 *
 * - `kind: "node"` is what the indexer emits for embeddable graph nodes.
 *   It carries the node's stable id and content hash so the resulting
 *   vector row can be tied back to the persisted node.
 * - `kind: "query"` is what retrieval emits for the user's query text.
 *   It never lands in `VectorStore.upsert` because `VectorRow` only
 *   accepts node-shaped payloads.
 */
export const EmbedInput = z.discriminatedUnion("kind", [
	EmbedNodeInput,
	EmbedQueryInput,
])
export type EmbedInput = z.infer<typeof EmbedInput>

export const EmbeddingResult = z.object({
	inputKind: z.enum(["node", "query"]),
	nodeId: z.string().optional(),
	queryId: z.string().optional(),
	vector: z.array(z.number().finite()).length(EMBEDDING_DIM),
	embeddingModel: z.string(),
	embeddingRevision: z.string(),
	embeddingDim: z.literal(EMBEDDING_DIM),
})
export type EmbeddingResult = z.infer<typeof EmbeddingResult>
