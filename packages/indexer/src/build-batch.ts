import type {
	EmbedInput,
	GraphEdge,
	GraphNode,
	Language,
} from "@codesoul/core"
import type { Parser } from "@codesoul/parser"

export type BuildBatchFile = {
	path: string
	language: Language
	source: string
}

export type BuildBatchInput = {
	repoId: string
	indexRunId: string
	batchId: string
	files: ReadonlyArray<BuildBatchFile>
}

export type BuildBatchResult = {
	nodes: GraphNode[]
	edges: GraphEdge[]
	vectorInputs: EmbedInput[]
}

/** Cap a single Block payload at this many characters before embedding so a
 * pathological mega-block can't blow up an embedder request. Phase 7. */
const BLOCK_TEXT_BUDGET = 4096

/**
 * Pure (filesystem-free) batch builder used to make indexer tests deterministic.
 *
 * Given files already loaded into memory, parses each one and emits the nodes,
 * edges, and EmbedInput payloads that should be persisted in this batch.
 *
 * EmbedInputs emitted here are always `kind: "node"`. Query embeddings live
 * in the retrieval pipeline.
 *
 * Two payloadKinds today:
 *   - "FunctionSummary" — one per Function/Method/Class node.
 *   - "Block"           — one per Block node (Phase 7). Block bodies are
 *                          extracted from `f.source` using the Block's
 *                          `evidence` line range, so we never re-parse.
 */
export const buildBatch = async (
	parser: Parser,
	input: BuildBatchInput,
): Promise<BuildBatchResult> => {
	const nodes: GraphNode[] = []
	const edges: GraphEdge[] = []
	const vectorInputs: EmbedInput[] = []

	for (const f of input.files) {
		if (!parser.languages.includes(f.language)) continue
		const result = await parser.parseFile({
			repoId: input.repoId,
			indexRunId: input.indexRunId,
			batchId: input.batchId,
			path: f.path,
			language: f.language,
			source: f.source,
		})
		nodes.push(...result.nodes)
		edges.push(...result.edges)

		// Cache source lines once per file for Block body slicing. We use
		// line ranges (already stored in evidence) instead of byte indices
		// so this stays parser-agnostic — MockParser doesn't expose a
		// tree-sitter SyntaxNode and that's fine; it never emits Block
		// nodes anyway, but the slicing path must still be safe.
		let sourceLines: string[] | null = null
		const getSourceLines = (): string[] => {
			if (!sourceLines) sourceLines = f.source.split("\n")
			return sourceLines
		}

		for (const n of result.nodes) {
			if (
				n.kind === "Function" ||
				n.kind === "Method" ||
				n.kind === "Class"
			) {
				vectorInputs.push({
					kind: "node",
					nodeId: n.id,
					contentHash: n.contentHash,
					payloadKind: "FunctionSummary",
					text: `${n.qualifiedName}\n${n.signature}`,
				})
			} else if (n.kind === "Block") {
				const lines = getSourceLines()
				const startIdx = Math.max(0, n.evidence.startLine - 1)
				const endIdx = Math.max(startIdx, n.evidence.endLine)
				const bodyText = lines.slice(startIdx, endIdx).join("\n")
				const capped =
					bodyText.length > BLOCK_TEXT_BUDGET
						? bodyText.slice(0, BLOCK_TEXT_BUDGET)
						: bodyText
				vectorInputs.push({
					kind: "node",
					nodeId: n.id,
					contentHash: n.contentHash,
					payloadKind: "Block",
					text: `${n.qualifiedName}\n${n.signature}\n${capped}`,
				})
			}
		}
	}

	return { nodes, edges, vectorInputs }
}
