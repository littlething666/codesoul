import { z } from "zod"

export const PersistedMeta = z.object({
	repoId: z.string().min(1),
	indexRunId: z.string().min(1),
	batchId: z.string().min(1),
	sourcePath: z.string().min(1),
	contentHash: z.string().regex(/^cnt_[0-9a-f]{40}$/),
	schemaVersion: z.literal(1),
})
export type PersistedMeta = z.infer<typeof PersistedMeta>
