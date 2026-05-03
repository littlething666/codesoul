import type { Candidate, ContextBundle, RankedCandidate } from "@codesoul/core"
import { CONTEXT_BUDGET_TOKENS, RETRIEVAL_LIMITS } from "@codesoul/core"
import type { Embedder } from "@codesoul/embedder"
import type { GraphStore } from "@codesoul/graph-store"
import type { Reranker } from "@codesoul/reranker"
import type { VectorStore, VectorSearchFilter } from "@codesoul/vector-store"

export type RetrievalDeps = {
	graph: GraphStore
	vectors: VectorStore
	embedder: Embedder
	reranker: Reranker
}

export type RetrievalInput = {
	query: string
	limit?: number
	filter?: VectorSearchFilter
}

/**
 * Phase 0/0.5 retrieval pipeline:
 *   parse -> exact -> vector -> graph expand -> merge -> rerank -> assemble
 *
 * Graph expansion is what makes CodeSoul more than a generic mock RAG: every
 * exact / semantic hit fans out by 1 hop in both directions to surface code
 * that is structurally connected to the seed.
 *
 * The query is embedded with `kind: "query"`; query vectors never land in
 * the vector store because `VectorRow` is node-shaped only.
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

	// 3. Semantic search (always embed the query in Phase 0).
	const [embedding] = await deps.embedder.embed([
		{
			kind: "query",
			queryId: "default",
			text: query,
		},
	])
	const semanticCandidates: Candidate[] = []
	if (embedding) {
		const hits = await deps.vectors.search({
			vector: embedding.vector,
			limit: RETRIEVAL_LIMITS.semanticHits,
			...(input.filter ? { filter: input.filter } : {}),
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

	// 4. GraphExpand: fan out one hop in both directions for each base candidate.
	const baseCandidates = [...exactCandidates, ...semanticCandidates]
	const seenForExpansion = new Set(baseCandidates.map((c) => c.nodeId))
	const graphCandidates: Candidate[] = []
	for (const c of baseCandidates) {
		const expanded = await deps.graph.neighbors(c.nodeId, {
			depth: 1,
			direction: "both",
			limit: RETRIEVAL_LIMITS.graphExpandedHits,
		})
		for (const node of expanded.nodes) {
			if (node.id === c.nodeId) continue
			if (seenForExpansion.has(node.id)) continue
			seenForExpansion.add(node.id)
			graphCandidates.push({
				nodeId: node.id,
				source: "graph",
				score: Math.max(0, c.score * 0.8),
				evidencePath: node.path,
				evidenceLines: [node.evidence.startLine, node.evidence.endLine],
			})
		}
	}

	// 5. MergeCandidates (dedupe; prefer the higher-score source).
	const merged = new Map<string, Candidate>()
	for (const c of [...exactCandidates, ...semanticCandidates, ...graphCandidates]) {
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
