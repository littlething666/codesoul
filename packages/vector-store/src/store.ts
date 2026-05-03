import type { VectorRow } from "@codesoul/core"

export type VectorSearchHit = {
	nodeId: string
	score: number
	payloadKind: VectorRow["payloadKind"]
}

/**
 * Optional filter applied during `VectorStore.search`.
 *
 * Without filters a long-lived local LanceDB table will cross-contaminate
 * results across repos and index runs. The mock honors the same filter
 * semantics so retrieval code can rely on them today.
 */
export type VectorSearchFilter = {
	repoId?: string
	indexRunId?: string
	payloadKind?: VectorRow["payloadKind"]
}

export interface VectorStore {
	upsert(rows: ReadonlyArray<VectorRow>): Promise<void>
	search(query: {
		vector: number[]
		limit: number
		filter?: VectorSearchFilter
	}): Promise<VectorSearchHit[]>
	listByRun(
		indexRunId: string,
		options?: { limit?: number },
	): Promise<VectorRow[]>
	countByRun(indexRunId: string): Promise<number>
	health(): Promise<{ ok: boolean; details?: string }>
}
