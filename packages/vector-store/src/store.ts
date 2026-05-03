import type { VectorRow } from "@codesoul/core"

export type VectorSearchHit = {
	nodeId: string
	score: number
	payloadKind: VectorRow["payloadKind"]
}

export interface VectorStore {
	upsert(rows: ReadonlyArray<VectorRow>): Promise<void>
	search(query: { vector: number[]; limit: number }): Promise<VectorSearchHit[]>
	countByRun(indexRunId: string): Promise<number>
	health(): Promise<{ ok: boolean; details?: string }>
}
