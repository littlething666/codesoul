import { z } from "zod"

export const ParserMode = z.enum(["regex", "tree-sitter"])
export type ParserMode = z.infer<typeof ParserMode>

export const GraphStoreMode = z.enum(["memory", "neo4j"])
export type GraphStoreMode = z.infer<typeof GraphStoreMode>

export const VectorStoreMode = z.enum(["memory", "lancedb"])
export type VectorStoreMode = z.infer<typeof VectorStoreMode>

export const EmbedderMode = z.enum(["mock", "http"])
export type EmbedderMode = z.infer<typeof EmbedderMode>

export const RerankerMode = z.enum(["mock", "http"])
export type RerankerMode = z.infer<typeof RerankerMode>

export const RigExtractorKind = z.enum([
	"package-json",
	"pyproject",
	"manual",
	"spade",
])
export type RigExtractorKind = z.infer<typeof RigExtractorKind>

/**
 * Single source of truth for how an index run is wired.
 *
 * Phase 0/0.5 always parses to memory + mock; later phases flip individual
 * fields without touching CLI flag parsing or wiring shape.
 */
export const IndexConfig = z.object({
	parser: ParserMode.default("regex"),
	graphStore: GraphStoreMode.default("memory"),
	vectorStore: VectorStoreMode.default("memory"),
	embedder: EmbedderMode.default("mock"),
	reranker: RerankerMode.default("mock"),
	rigExtractors: z.array(RigExtractorKind).default([]),
	enableSpade: z.boolean().default(false),
})
export type IndexConfig = z.infer<typeof IndexConfig>

export const defaultIndexConfig = (): IndexConfig => IndexConfig.parse({})
