import type { Candidate, RankedCandidate } from "@codesoul/core"

export type RerankOptions = {
	timeoutMs?: number
}

export interface Reranker {
	readonly modelId: string
	readonly modelRevision: string
	rerank(
		query: string,
		candidates: ReadonlyArray<Candidate>,
		options?: RerankOptions,
	): Promise<RankedCandidate[]>
}
