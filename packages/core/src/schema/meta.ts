import { z } from "zod"

/**
 * Metadata persisted on every record (nodes, edges, vector rows).
 *
 * `contentHash` is a per-record content identity hash whose meaning depends
 * on the DTO it is attached to:
 *
 *   - GraphNode:  contentId(normalizedSignature, normalizedBody) of the symbol.
 *   - GraphEdge:  edgeContentHash(src, type, dst).
 *   - VectorRow:  contentHash of the source node's payload, mirrored from
 *                 the matching GraphNode so vector rows can be invalidated
 *                 when the node's content changes.
 *
 * In a future phase we may rename this to `recordHash` or split it by DTO.
 * For Phase 0/0.5 it is intentionally a single field; adapters MUST persist
 * it as-is and MUST NOT collapse it onto a single uniform definition.
 */
export const PersistedMeta = z.object({
	repoId: z.string().min(1),
	indexRunId: z.string().min(1),
	batchId: z.string().min(1),
	sourcePath: z.string().min(1),
	contentHash: z.string().regex(/^cnt_[0-9a-f]{40}$/),
	schemaVersion: z.literal(1),
})
export type PersistedMeta = z.infer<typeof PersistedMeta>
