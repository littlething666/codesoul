import type { GraphEdge, GraphNode, Language, NodeKind } from "@codesoul/core"
import {
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
	SCHEMA_VERSION,
	contentId,
	edgeContentHash,
	normalizeBody,
	normalizeSignature,
	stableId,
} from "@codesoul/core"
import type { Parser, ParseResult } from "./parser.js"

const computeLine = (text: string, offset: number): number => {
	let line = 1
	const end = Math.min(offset, text.length)
	for (let i = 0; i < end; i++) {
		if (text[i] === "\n") line++
	}
	return line
}

type DeclPattern = {
	regex: RegExp
	kind: Extract<NodeKind, "Function" | "Class">
}

// Phase 0 contract: top-level (file-scope) functions and classes only.
// No methods, no arrow functions, no class members, no imports.
// Methods land in Phase 1 (tree-sitter), where they will be emitted as Method.
const patternsFor = (language: Language): DeclPattern[] => {
	if (language === "typescript" || language === "javascript") {
		return [
			{
				regex:
					/(?:^|\n)(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(\([^)]*\))/g,
				kind: "Function",
			},
			{
				regex: /(?:^|\n)(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
				kind: "Class",
			},
		]
	}
	if (language === "python") {
		return [
			{
				regex: /(?:^|\n)def\s+([A-Za-z_][\w]*)\s*(\([^)]*\))/g,
				kind: "Function",
			},
			{
				regex: /(?:^|\n)class\s+([A-Za-z_][\w]*)/g,
				kind: "Class",
			},
		]
	}
	return []
}

export class MockParser implements Parser {
	readonly languages: ReadonlyArray<Language> = [
		"typescript",
		"javascript",
		"python",
	]

	async parseFile(args: {
		repoId: string
		indexRunId: string
		batchId: string
		path: string
		language: Language
		source: string
	}): Promise<ParseResult> {
		const nodes: GraphNode[] = []
		const edges: GraphEdge[] = []

		const totalLines = Math.max(1, args.source.split("\n").length)
		const fileQName = args.path
		const fileNodeId = stableId({
			repoId: args.repoId,
			relativePath: args.path,
			symbolKind: "File",
			qualifiedName: fileQName,
		})
		const fileContentId = contentId({
			normalizedSignature: normalizeSignature(""),
			normalizedBody: normalizeBody(args.source),
		})
		const fileNode: GraphNode = GraphNodeSchema.parse({
			id: fileNodeId,
			contentHash: fileContentId,
			repoId: args.repoId,
			indexRunId: args.indexRunId,
			batchId: args.batchId,
			sourcePath: args.path,
			schemaVersion: SCHEMA_VERSION,
			path: args.path,
			kind: "File",
			language: args.language,
			qualifiedName: fileQName,
			signature: "",
			evidence: { startLine: 1, endLine: totalLines },
		})
		nodes.push(fileNode)

		for (const { regex, kind } of patternsFor(args.language)) {
			regex.lastIndex = 0
			let m: RegExpExecArray | null
			while ((m = regex.exec(args.source)) !== null) {
				const name = m[1] ?? ""
				if (!name) continue
				const sig = m[2] ?? ""
				const leadingNewline = m[0].startsWith("\n") ? 1 : 0
				const offset = m.index + leadingNewline
				const startLine = computeLine(args.source, offset)
				const qualifiedName = `${args.path}::${name}`
				const id = stableId({
					repoId: args.repoId,
					relativePath: args.path,
					symbolKind: kind,
					qualifiedName,
				})
				const cId = contentId({
					normalizedSignature: normalizeSignature(`${name}${sig}`),
					normalizedBody: normalizeBody(`${name}${sig}`),
				})
				const node: GraphNode = GraphNodeSchema.parse({
					id,
					contentHash: cId,
					repoId: args.repoId,
					indexRunId: args.indexRunId,
					batchId: args.batchId,
					sourcePath: args.path,
					schemaVersion: SCHEMA_VERSION,
					path: args.path,
					kind,
					language: args.language,
					qualifiedName,
					signature: `${name}${sig}`,
					evidence: { startLine, endLine: startLine },
				})
				nodes.push(node)
				const edgeHash = edgeContentHash({
					src: fileNodeId,
					type: "CONTAINS",
					dst: id,
				})
				const edge: GraphEdge = GraphEdgeSchema.parse({
					src: fileNodeId,
					dst: id,
					type: "CONTAINS",
					repoId: args.repoId,
					indexRunId: args.indexRunId,
					batchId: args.batchId,
					sourcePath: args.path,
					contentHash: edgeHash,
					schemaVersion: SCHEMA_VERSION,
				})
				edges.push(edge)
			}
		}

		return { nodes, edges }
	}
}
