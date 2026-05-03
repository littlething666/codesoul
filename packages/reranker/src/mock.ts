import type { Candidate, RankedCandidate } from "@codesoul/core"
import type { Reranker, RerankOptions } from "./reranker.js"

export class MockReranker implements Reranker {
	readonly modelId = "mock-reranker"
	readonly modelRevision = "0"

	async rerank(
		_query: string,
		candidates: ReadonlyArray<Candidate>,
		_options?: RerankOptions,
	): Promise<RankedCandidate[]> {
		return candidates.map((c) => ({ ...c, rerankScore: c.score }))
	}
}
