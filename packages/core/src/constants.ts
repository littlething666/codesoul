export const SCHEMA_VERSION = 1 as const
export const EMBEDDING_DIM = 1024 as const

export const RETRIEVAL_LIMITS = {
	exactSymbolHits: 20,
	semanticHits: 30,
	graphExpandedHits: 30,
	rerankInput: 60,
	finalSnippets: 10,
} as const

export const CONTEXT_BUDGET_TOKENS = {
	total: 8_000,
	system: 1_000,
	architecture: 1_000,
	snippets: 5_500,
	citations: 500,
} as const
