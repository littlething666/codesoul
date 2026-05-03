import { z } from "zod"
import { EMBEDDING_DIM } from "../constants.js"
import { PersistedMeta } from "./meta.js"

export const VectorRow = PersistedMeta.extend({
	nodeId: z.string().regex(/^sym_[0-9a-f]{40}$/),
	embeddingModel: z.string(),
	embeddingRevision: z.string(),
	embeddingDim: z.literal(EMBEDDING_DIM),
	vector: z.array(z.number().finite()).length(EMBEDDING_DIM),
	payloadKind: z.enum(["FunctionSummary", "Block", "Markdown"]),
})
export type VectorRow = z.infer<typeof VectorRow>
