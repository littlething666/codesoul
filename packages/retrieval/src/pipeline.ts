import type { Candidate, ContextBundle, RankedCandidate } from "@codesoul/core"
import { CONTEXT_BUDGET_TOKENS, RETRIEVAL_LIMITS } from "@codesoul/core"
import type { Embedder } from "@codesoul/embedder"
import type { GraphStore } from "@codesoul/graph-store"
import type { Reranker } from "@codesoul/reranker"
import type { VectorStore } from "@codesoul/vector-store"

export type RetrievalDeps = {
	graph: GraphStore
	vectors: VectorStore
	embedder: Embedder
	reranker: Reranker
}

export type RetrievalInput = {
	query: string
	limit?: number
}

/**
 * Phase 0 retrieval skeleton: parse → exact → semantic → merge → rerank → assemble.
 * Graph expansion and macro-summary inclusion land in later phases.
 */
export const retrieve = async (
	deps: RetrievalDeps,
	input: RetrievalInput,
): Promise<ContextBundle> => {
	const { query } = input
	const limit = input.limit ?? RETRIEVAL_LIMITS.finalSnippets

	// 1. ParseQuery (skeleton): naive identifier extraction.
	const identifiers = query
		.split(/\s+/)
		.filter((t) => /^[A-Za-z_][\w]*$/.test(t))

	// 2. ExactLookup
	const exactCandidates: Candidate[] = []
	for (const ident of identifiers) {
		const matches = await deps.graph.findByQualifiedName(ident)
		for (const node of matches.slice(0, RETRIEVAL_LIMITS.exactSymbolHits)) {
			exactCandidates.push({
				nodeId: node.id,
				source: "exact",
				score: 1,
				evidencePath: node.path,
				evidenceLines: [node.evidence.startLine, node.evidence.endLine],
			})
		}
	}

	// 3+4. Semantic search
	const [embedding] = await deps.embedder.embed([
		{
			nodeId: "__query__",
			contentHash: "cnt_0000000000000000000000000000000000000000",
			payloadKind: "FunctionSummary",
			text: query,
		},
	])
	const semanticCandidates: Candidate[] = []
	if (embedding) {
		const hits = await deps.vectors.search({
			vector: embedding.vector,
			limit: RETRIEVAL_LIMITS.semanticHits,
		})
		for (const hit of hits) {
			const node = await deps.graph.getNode(hit.nodeId)
			if (!node) continue
			semanticCandidates.push({
				nodeId: hit.nodeId,
				source: "semantic",
				score: hit.score,
				evidencePath: node.path,
				evidenceLines: [node.evidence.startLine, node.evidence.endLine],
			})
		}
	}

	// 5. MergeCandidates (dedupe, prefer higher score)
	const merged = new Map<string, Candidate>()
	for (const c of [...exactCandidates, ...semanticCandidates]) {
		const existing = merged.get(c.nodeId)
		if (!existing || c.score > existing.score) merged.set(c.nodeId, c)
	}
	const candidates = Array.from(merged.values()).slice(
		0,
		RETRIEVAL_LIMITS.rerankInput,
	)

	// 6. Rerank
	const ranked: RankedCandidate[] = await deps.reranker.rerank(query, candidates)
	ranked.sort((a, b) => b.rerankScore - a.rerankScore)

	// 7. AssembleContext
	const finalCandidates = ranked.slice(0, limit)
	return {
		query,
		snippets: finalCandidates.map((c) => ({
			nodeId: c.nodeId,
			path: c.evidencePath,
			lines: c.evidenceLines,
			text: "",
		})),
		citations: finalCandidates.map(
			(c) => `${c.evidencePath}:${c.evidenceLines[0]}-${c.evidenceLines[1]}`,
		),
		tokenBudget: {
			total: CONTEXT_BUDGET_TOKENS.total,
			used: 0,
		},
	}
}
