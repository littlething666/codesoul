import type { GraphEdge, GraphNode, Language } from "@codesoul/core"
import {
	ByteTokenEstimator,
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
	SCHEMA_VERSION,
	contentId,
	edgeContentHash,
	normalizeBody,
	normalizeSignature,
	stableId,
	type TokenEstimator,
} from "@codesoul/core"

/** Functions whose estimated tokens exceed this threshold are split into Blocks. */
export const DEFAULT_BLOCK_TOKEN_THRESHOLD = 512

/** Functions whose line span exceeds this threshold are split into Blocks. */
export const DEFAULT_BLOCK_LINE_THRESHOLD = 60

export type BlockExtractionOptions = {
	/** Estimated-token trigger threshold. Defaults to 512. */
	tokenThreshold?: number
	/** Body line-span trigger threshold. Defaults to 60. */
	lineThreshold?: number
}

/**
 * Block kinds, matching the keyword that introduces the block in source.
 *
 * Stored as the Block's `signature` so downstream consumers can filter on
 * a specific block kind without re-parsing the body text.
 */
export type BlockKind =
	| "if"
	| "for"
	| "while"
	| "do"
	| "try"
	| "switch"
	| "match"
	| "function"
	| "class"

/**
 * Structural shape of a tree-sitter SyntaxNode that block extraction needs.
 *
 * Declared structurally so this file does not import tree-sitter directly
 * and stays unit-testable with synthetic nodes.
 */
export interface BlockSyntaxNode {
	type: string
	startIndex: number
	endIndex: number
	startPosition: { row: number; column: number }
	endPosition: { row: number; column: number }
	namedChildCount: number
	namedChild(i: number): BlockSyntaxNode | null
}

// TS / JS body's named children: which syntactic types we treat as blocks.
const TS_BLOCK_TYPES: Readonly<Record<string, BlockKind>> = {
	if_statement: "if",
	for_statement: "for",
	for_in_statement: "for",
	while_statement: "while",
	do_statement: "do",
	try_statement: "try",
	switch_statement: "switch",
	function_declaration: "function",
	class_declaration: "class",
}

// Python body's named children: same idea.
const PY_BLOCK_TYPES: Readonly<Record<string, BlockKind>> = {
	if_statement: "if",
	for_statement: "for",
	while_statement: "while",
	try_statement: "try",
	match_statement: "match",
	function_definition: "function",
	class_definition: "class",
}

const blockKindFor = (
	language: Language,
	syntaxType: string,
): BlockKind | null => {
	const table = language === "python" ? PY_BLOCK_TYPES : TS_BLOCK_TYPES
	return table[syntaxType] ?? null
}

/**
 * Pure trigger predicate. Returns true when EITHER the body's estimated
 * token count or its line span crosses its threshold.
 *
 * Using OR matches the planning doc's §Block extraction trigger answer:
 * either signal alone is enough to warrant splitting a function.
 */
export const shouldExtractBlocks = (
	bodyText: string,
	lineSpan: number,
	options: BlockExtractionOptions = {},
	tokenEstimator: TokenEstimator = new ByteTokenEstimator(),
): boolean => {
	const tokenThreshold = options.tokenThreshold ?? DEFAULT_BLOCK_TOKEN_THRESHOLD
	const lineThreshold = options.lineThreshold ?? DEFAULT_BLOCK_LINE_THRESHOLD
	if (lineSpan > lineThreshold) return true
	return tokenEstimator.estimate(bodyText) > tokenThreshold
}

export type ExtractBlocksArgs = {
	repoId: string
	indexRunId: string
	batchId: string
	path: string
	language: Language
	/** stableId of the parent Function/Method node. */
	parentNodeId: string
	/** qualifiedName of the parent (e.g. "src/x.ts::C.foo"). */
	parentQualifiedName: string
	/** The tree-sitter body node whose immediate children we walk. */
	bodyNode: BlockSyntaxNode
	/** Full source so we can slice block bodies by byte index. */
	source: string
	/** Body text used by the trigger predicate. */
	parentBodyText: string
	/** Body line span used by the trigger predicate. */
	parentLineSpan: number
	options?: BlockExtractionOptions
	tokenEstimator?: TokenEstimator
}

export type ExtractBlocksResult = {
	nodes: GraphNode[]
	edges: GraphEdge[]
}

/**
 * Walk the immediate named children of a Function/Method body and emit
 * Block nodes plus a CONTAINS edge from the parent for each.
 *
 * No-op when the trigger predicate returns false — small bodies stay as
 * a single Function/Method embedding (FunctionSummary), and large bodies
 * pick up per-block embeddings in addition to the function-level one.
 */
export const extractBlocks = (
	args: ExtractBlocksArgs,
): ExtractBlocksResult => {
	const nodes: GraphNode[] = []
	const edges: GraphEdge[] = []

	if (
		!shouldExtractBlocks(
			args.parentBodyText,
			args.parentLineSpan,
			args.options,
			args.tokenEstimator,
		)
	) {
		return { nodes, edges }
	}

	let ordinal = 0
	for (let i = 0; i < args.bodyNode.namedChildCount; i++) {
		const child = args.bodyNode.namedChild(i)
		if (!child) continue
		const blockKind = blockKindFor(args.language, child.type)
		if (!blockKind) continue

		const qualifiedName = `${args.parentQualifiedName}#block:${ordinal}`
		const id = stableId({
			repoId: args.repoId,
			relativePath: args.path,
			symbolKind: "Block",
			qualifiedName,
		})
		const bodyText = args.source.slice(child.startIndex, child.endIndex)
		const startLine = child.startPosition.row + 1
		const endLine = child.endPosition.row + 1

		nodes.push(
			GraphNodeSchema.parse({
				id,
				contentHash: contentId({
					normalizedSignature: normalizeSignature(blockKind),
					normalizedBody: normalizeBody(bodyText),
				}),
				repoId: args.repoId,
				indexRunId: args.indexRunId,
				batchId: args.batchId,
				sourcePath: args.path,
				schemaVersion: SCHEMA_VERSION,
				path: args.path,
				kind: "Block",
				language: args.language,
				qualifiedName,
				signature: blockKind,
				evidence: { startLine, endLine },
			}),
		)

		edges.push(
			GraphEdgeSchema.parse({
				src: args.parentNodeId,
				dst: id,
				type: "CONTAINS",
				repoId: args.repoId,
				indexRunId: args.indexRunId,
				batchId: args.batchId,
				sourcePath: args.path,
				contentHash: edgeContentHash({
					src: args.parentNodeId,
					type: "CONTAINS",
					dst: id,
				}),
				schemaVersion: SCHEMA_VERSION,
			}),
		)

		ordinal++
	}

	return { nodes, edges }
}

/**
 * Re-export the source text of a block by slicing on byte indices. Useful
 * for callers that want to embed the block body separately (e.g. the
 * indexer's buildBatch step emitting payloadKind: "Block" EmbedInputs).
 */
export const blockBodyText = (
	source: string,
	node: BlockSyntaxNode,
): string => source.slice(node.startIndex, node.endIndex)
