import { z } from "zod"

export const BatchStatus = z.enum(["pending", "committed", "failed"])
export type BatchStatus = z.infer<typeof BatchStatus>

export const BatchManifest = z.object({
	batchId: z.string(),
	indexRunId: z.string(),
	repoId: z.string(),
	sourcePath: z.string(),
	sourceContentHash: z.string().regex(/^cnt_[0-9a-f]{40}$/),
	status: BatchStatus,
	nodeCount: z.number().int().nonnegative(),
	edgeCount: z.number().int().nonnegative(),
	vectorCount: z.number().int().nonnegative(),
	createdAt: z.string().datetime(),
	committedAt: z.string().datetime().nullable(),
	checksum: z.string(),
	schemaVersion: z.literal(1),
})
export type BatchManifest = z.infer<typeof BatchManifest>

export const IngestionManifest = z.object({
	indexRunId: z.string(),
	repoId: z.string(),
	startedAt: z.string().datetime(),
	finishedAt: z.string().datetime().nullable(),
	embeddingModel: z.string(),
	embeddingRevision: z.string(),
	embeddingDim: z.number().int(),
	rerankerModel: z.string().nullable(),
	rerankerRevision: z.string().nullable(),
	tokenizerVersion: z.string(),
	schemaVersion: z.literal(1),
})
export type IngestionManifest = z.infer<typeof IngestionManifest>
