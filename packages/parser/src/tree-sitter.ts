import { createRequire } from "node:module"
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

// ---- Native binding loaders -------------------------------------------------
//
// `tree-sitter` and its grammar packages ship as CommonJS native modules.
// Using `createRequire` keeps this file working under `"type": "module"` no
// matter how downstream interop flags are configured, and confines the
// untyped binding shape to this file.
const require = createRequire(import.meta.url)

interface SyntaxNode {
	type: string
	text: string
	startPosition: { row: number; column: number }
	endPosition: { row: number; column: number }
	startIndex: number
	endIndex: number
	namedChildCount: number
	namedChild(i: number): SyntaxNode | null
	childForFieldName(name: string): SyntaxNode | null
}

interface Tree {
	rootNode: SyntaxNode
}

interface TreeSitterInstance {
	setLanguage(lang: unknown): void
	parse(source: string): Tree
}

interface TreeSitterCtor {
	new (): TreeSitterInstance
}

const TreeSitter = require("tree-sitter") as TreeSitterCtor
const TypeScriptGrammars = require("tree-sitter-typescript") as {
	typescript: unknown
	tsx: unknown
}
const PythonGrammar = require("tree-sitter-python") as unknown

// ---- Decl extraction --------------------------------------------------------

type DeclKind = Extract<NodeKind, "Class" | "Function" | "Method">

type Decl = {
	kind: DeclKind
	name: string
	signature: string
	bodyText: string
	startLine: number
	endLine: number
	parentClassName?: string
}

const SUPPORTED: ReadonlyArray<Language> = [
	"typescript",
	"javascript",
	"python",
]

const collectTypescript = (root: SyntaxNode, source: string): Decl[] => {
	const decls: Decl[] = []
	const visit = (node: SyntaxNode, parentClassName: string | null): void => {
		const t = node.type
		if (t === "function_declaration") {
			const nameNode = node.childForFieldName("name")
			const paramsNode = node.childForFieldName("parameters")
			if (nameNode) {
				const name = nameNode.text
				const signature = `${name}${paramsNode?.text ?? "()"}`
				decls.push({
					kind: "Function",
					name,
					signature,
					bodyText: source.slice(node.startIndex, node.endIndex),
					startLine: node.startPosition.row + 1,
					endLine: node.endPosition.row + 1,
				})
			}
			// Phase 2A: do not descend into function bodies. Nested
			// declarations land in later splits.
			return
		}
		if (t === "class_declaration") {
			const nameNode = node.childForFieldName("name")
			const className = nameNode?.text ?? ""
			if (className) {
				decls.push({
					kind: "Class",
					name: className,
					signature: className,
					bodyText: source.slice(node.startIndex, node.endIndex),
					startLine: node.startPosition.row + 1,
					endLine: node.endPosition.row + 1,
				})
				const body = node.childForFieldName("body")
				if (body) {
					for (let i = 0; i < body.namedChildCount; i++) {
						const child = body.namedChild(i)
						if (child) visit(child, className)
					}
				}
			}
			return
		}
		if (t === "method_definition" && parentClassName) {
			const nameNode = node.childForFieldName("name")
			const paramsNode = node.childForFieldName("parameters")
			if (nameNode) {
				const name = nameNode.text
				const signature = `${name}${paramsNode?.text ?? "()"}`
				decls.push({
					kind: "Method",
					name,
					signature,
					bodyText: source.slice(node.startIndex, node.endIndex),
					startLine: node.startPosition.row + 1,
					endLine: node.endPosition.row + 1,
					parentClassName,
				})
			}
			return
		}
		// Descend through structural wrappers (program, export_statement,
		// export_default_declaration, decorator wrappers, etc.).
		for (let i = 0; i < node.namedChildCount; i++) {
			const child = node.namedChild(i)
			if (child) visit(child, parentClassName)
		}
	}
	visit(root, null)
	return decls
}

const collectPython = (root: SyntaxNode, source: string): Decl[] => {
	const decls: Decl[] = []
	const visit = (node: SyntaxNode, parentClassName: string | null): void => {
		const t = node.type
		if (t === "function_definition") {
			const nameNode = node.childForFieldName("name")
			const paramsNode = node.childForFieldName("parameters")
			if (nameNode) {
				const name = nameNode.text
				const signature = `${name}${paramsNode?.text ?? "()"}`
				const decl: Decl = parentClassName
					? {
							kind: "Method",
							name,
							signature,
							bodyText: source.slice(node.startIndex, node.endIndex),
							startLine: node.startPosition.row + 1,
							endLine: node.endPosition.row + 1,
							parentClassName,
						}
					: {
							kind: "Function",
							name,
							signature,
							bodyText: source.slice(node.startIndex, node.endIndex),
							startLine: node.startPosition.row + 1,
							endLine: node.endPosition.row + 1,
						}
				decls.push(decl)
			}
			return
		}
		if (t === "class_definition") {
			const nameNode = node.childForFieldName("name")
			const className = nameNode?.text ?? ""
			if (className) {
				decls.push({
					kind: "Class",
					name: className,
					signature: className,
					bodyText: source.slice(node.startIndex, node.endIndex),
					startLine: node.startPosition.row + 1,
					endLine: node.endPosition.row + 1,
				})
				const body = node.childForFieldName("body")
				if (body) {
					for (let i = 0; i < body.namedChildCount; i++) {
						const child = body.namedChild(i)
						if (child) visit(child, className)
					}
				}
			}
			return
		}
		// Descend through module / decorated_definition / etc.
		for (let i = 0; i < node.namedChildCount; i++) {
			const child = node.namedChild(i)
			if (child) visit(child, parentClassName)
		}
	}
	visit(root, null)
	return decls
}

const qualifiedNameFor = (path: string, decl: Decl): string => {
	if (decl.kind === "Method" && decl.parentClassName) {
		return `${path}::${decl.parentClassName}.${decl.name}`
	}
	return `${path}::${decl.name}`
}

// ---- Public parser ----------------------------------------------------------

export class TreeSitterParser implements Parser {
	readonly languages: ReadonlyArray<Language> = SUPPORTED

	private readonly tsParser: TreeSitterInstance
	private readonly pyParser: TreeSitterInstance

	constructor() {
		this.tsParser = new TreeSitter()
		this.tsParser.setLanguage(TypeScriptGrammars.typescript)
		this.pyParser = new TreeSitter()
		this.pyParser.setLanguage(PythonGrammar)
	}

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

		// File node — emitted unconditionally so every parsed file shows up
		// in the graph, even when the language is out of scope for Phase 2A.
		const totalLines = Math.max(1, args.source.split("\n").length)
		const fileQName = args.path
		const fileNodeId = stableId({
			repoId: args.repoId,
			relativePath: args.path,
			symbolKind: "File",
			qualifiedName: fileQName,
		})
		const fileContentHash = contentId({
			normalizedSignature: normalizeSignature(""),
			normalizedBody: normalizeBody(args.source),
		})
		const fileNode: GraphNode = GraphNodeSchema.parse({
			id: fileNodeId,
			contentHash: fileContentHash,
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

		if (!SUPPORTED.includes(args.language)) {
			return { nodes, edges }
		}

		const parser =
			args.language === "python" ? this.pyParser : this.tsParser
		const tree = parser.parse(args.source)
		const decls =
			args.language === "python"
				? collectPython(tree.rootNode, args.source)
				: collectTypescript(tree.rootNode, args.source)

		for (const decl of decls) {
			const qualifiedName = qualifiedNameFor(args.path, decl)
			const id = stableId({
				repoId: args.repoId,
				relativePath: args.path,
				symbolKind: decl.kind,
				qualifiedName,
			})
			const cId = contentId({
				normalizedSignature: normalizeSignature(decl.signature),
				normalizedBody: normalizeBody(decl.bodyText),
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
				kind: decl.kind,
				language: args.language,
				qualifiedName,
				signature: decl.signature,
				evidence: { startLine: decl.startLine, endLine: decl.endLine },
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

		return { nodes, edges }
	}
}
