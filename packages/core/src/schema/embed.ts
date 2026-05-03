import { z } from "zod"
import { EMBEDDING_DIM } from "../constants.js"

export const EmbedInput = z.object({
	nodeId: z.string(),
	contentHash: z.string(),
	payloadKind: z.enum(["FunctionSummary", "Block", "Markdown"]),
	text: z.string(),
})
export type EmbedInput = z.infer<typeof EmbedInput>

export const EmbeddingResult = z.object({
	nodeId: z.string(),
	vector: z.array(z.number().finite()).length(EMBEDDING_DIM),
	embeddingModel: z.string(),
	embeddingRevision: z.string(),
	embeddingDim: z.literal(EMBEDDING_DIM),
})
export type EmbeddingResult = z.infer<typeof EmbeddingResult>
