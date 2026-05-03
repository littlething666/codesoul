import type { GraphEdge, GraphNode, Language, NodeKind } from "@codesoul/core"
import {
	SCHEMA_VERSION,
	contentId,
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

const patternsFor = (language: Language): DeclPattern[] => {
	if (language === "typescript" || language === "javascript") {
		return [
			{
				regex:
					/(?:^|\n)\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(\([^)]*\))/g,
				kind: "Function",
			},
			{
				regex: /(?:^|\n)\s*(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g,
				kind: "Class",
			},
		]
	}
	if (language === "python") {
		return [
			{
				regex: /(?:^|\n)[\t ]*def\s+([A-Za-z_][\w]*)\s*(\([^)]*\))/g,
				kind: "Function",
			},
			{
				regex: /(?:^|\n)[\t ]*class\s+([A-Za-z_][\w]*)/g,
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
		const fileNode: GraphNode = {
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
		}
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
				nodes.push({
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
				edges.push({
					src: fileNodeId,
					dst: id,
					type: "CONTAINS",
					repoId: args.repoId,
					indexRunId: args.indexRunId,
					batchId: args.batchId,
					sourcePath: args.path,
					contentHash: cId,
					schemaVersion: SCHEMA_VERSION,
				})
			}
		}

		return { nodes, edges }
	}
}
