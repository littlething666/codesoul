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

// ---- Decl extraction (Phase 2A) --------------------------------------------

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

// ---- Import extraction (Phase 2B) ------------------------------------------

type ImportInfo = {
	specifier: string
	startLine: number
	endLine: number
	bodyText: string
}

const stripStringLiteral = (text: string): string => {
	if (text.length < 2) return text
	const first = text[0]
	const last = text[text.length - 1]
	if (
		(first === '"' || first === "'" || first === "`") &&
		first === last
	) {
		return text.slice(1, -1)
	}
	return text
}

/**
 * TS/JS imports always live at the program (top) level in well-formed
 * source, so a shallow scan over the program's named children is correct
 * and noticeably cheaper than a full descent. Re-exports of the form
 * `export { x } from "./x.js"` are imports of `./x.js` for dependency-graph
 * purposes and are handled here too.
 */
const collectTypescriptImports = (
	root: SyntaxNode,
	source: string,
): ImportInfo[] => {
	const imports: ImportInfo[] = []
	for (let i = 0; i < root.namedChildCount; i++) {
		const child = root.namedChild(i)
		if (!child) continue
		if (child.type === "import_statement") {
			const sourceNode = child.childForFieldName("source")
			if (sourceNode) {
				imports.push({
					specifier: stripStringLiteral(sourceNode.text),
					startLine: child.startPosition.row + 1,
					endLine: child.endPosition.row + 1,
					bodyText: source.slice(child.startIndex, child.endIndex),
				})
			}
		} else if (child.type === "export_statement") {
			const sourceNode = child.childForFieldName("source")
			if (sourceNode) {
				imports.push({
					specifier: stripStringLiteral(sourceNode.text),
					startLine: child.startPosition.row + 1,
					endLine: child.endPosition.row + 1,
					bodyText: source.slice(child.startIndex, child.endIndex),
				})
			}
		}
	}
	return imports
}

/**
 * Python imports come in two flavors:
 *
 *   - `import_statement` (`import x`, `import x, y as z`) emits one
 *     ImportInfo per imported module name.
 *   - `import_from_statement` (`from x import y, z`) emits exactly one
 *     ImportInfo for the source module x, regardless of how many names are
 *     pulled in. The granularity we care about for the dependency graph is
 *     the module, not the symbol.
 */
const collectPythonImports = (
	root: SyntaxNode,
	source: string,
): ImportInfo[] => {
	const imports: ImportInfo[] = []
	for (let i = 0; i < root.namedChildCount; i++) {
		const child = root.namedChild(i)
		if (!child) continue
		if (child.type === "import_statement") {
			for (let j = 0; j < child.namedChildCount; j++) {
				const item = child.namedChild(j)
				if (!item) continue
				let moduleName: string | null = null
				if (item.type === "dotted_name") {
					moduleName = item.text
				} else if (item.type === "aliased_import") {
					const nameNode =
						item.childForFieldName("name") ?? item.namedChild(0)
					moduleName = nameNode?.text ?? null
				}
				if (moduleName) {
					imports.push({
						specifier: moduleName,
						startLine: child.startPosition.row + 1,
						endLine: child.endPosition.row + 1,
						bodyText: source.slice(
							child.startIndex,
							child.endIndex,
						),
					})
				}
			}
		} else if (child.type === "import_from_statement") {
			const moduleNameNode = child.childForFieldName("module_name")
			const moduleName = moduleNameNode?.text
			if (moduleName) {
				imports.push({
					specifier: moduleName,
					startLine: child.startPosition.row + 1,
					endLine: child.endPosition.row + 1,
					bodyText: source.slice(child.startIndex, child.endIndex),
				})
			}
		}
	}
	return imports
}

/**
 * Map a TS/JS import specifier extension to the on-disk source extension.
 *
 * ESM TS sources import siblings using `.js` suffixes per the spec, but the
 * actual files end in `.ts` / `.tsx` / `.mts` / `.cts`. We follow that
 * convention here so a `from "./greet.js"` import resolves to the
 * `src/greet.ts` File node id, matching what the parser will emit when that
 * file is parsed.
 */
const TS_RESOLVE_EXT: Record<string, string> = {
	".js": ".ts",
	".jsx": ".tsx",
	".mjs": ".mts",
	".cjs": ".cts",
	".ts": ".ts",
	".tsx": ".tsx",
	".mts": ".mts",
	".cts": ".cts",
}

/**
 * Resolve a `./` or `../` relative TS/JS import specifier against the
 * importing file's path, returning the on-disk-relative path of the imported
 * module, or null if resolution can't be done deterministically:
 *
 *   - bare specifiers (`react`, `node:fs`)
 *   - extensionless or directory imports (we do NOT probe `index.ts`)
 *   - paths that escape the repo root
 *
 * This is deliberately filesystem-free; the result is a stable string the
 * caller turns into a File node id via `stableId`. When the import target
 * is later parsed, its File node will get the same id, so the File→File
 * IMPORTS edge connects automatically.
 */
const resolveLocalTsImport = (
	sourcePath: string,
	specifier: string,
): string | null => {
	if (!specifier.startsWith("./") && !specifier.startsWith("../")) {
		return null
	}
	const lastSlash = sourcePath.lastIndexOf("/")
	const dir = lastSlash >= 0 ? sourcePath.slice(0, lastSlash) : ""
	const combined = dir ? `${dir}/${specifier}` : specifier
	const parts: string[] = []
	for (const segment of combined.split("/")) {
		if (segment === "" || segment === ".") continue
		if (segment === "..") {
			if (parts.length === 0) return null
			parts.pop()
			continue
		}
		parts.push(segment)
	}
	if (parts.length === 0) return null
	const resolved = parts.join("/")
	const lastSegStart = resolved.lastIndexOf("/")
	const dotIdx = resolved.lastIndexOf(".")
	if (dotIdx <= lastSegStart) {
		// No extension on the final segment. Could be a directory import or
		// a TS-style extensionless one. Either way we don't have enough
		// information to map to a single on-disk path.
		return null
	}
	const ext = resolved.slice(dotIdx)
	const target = TS_RESOLVE_EXT[ext]
	if (!target) return null
	return `${resolved.slice(0, dotIdx)}${target}`
}

// ---- Public parser ---------------------------------------------------------

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
		// in the graph, even when the language is out of scope for Phase 2.
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

		// --- Decls (Phase 2A) ---
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

		// --- Imports (Phase 2B) ---
		//
		// Every import statement gets:
		//   - one Import node (deduped by stable id within the file)
		//   - File→Import CONTAINS edge
		//   - File→Import IMPORTS edge
		//
		// TS/JS local relative imports additionally get a File→File IMPORTS
		// edge using the deterministically computed target File node id, so
		// when the imported file is parsed later in the same run its File
		// node id matches and the edge connects.
		//
		// Python imports never get File→File resolution — cross-module
		// resolution is intentionally deferred to a later phase.
		const importInfos =
			args.language === "python"
				? collectPythonImports(tree.rootNode, args.source)
				: collectTypescriptImports(tree.rootNode, args.source)

		const seenImportIds = new Set<string>()
		for (const imp of importInfos) {
			const qualifiedName = `${args.path}::import:${imp.specifier}`
			const id = stableId({
				repoId: args.repoId,
				relativePath: args.path,
				symbolKind: "Import",
				qualifiedName,
			})
			if (!seenImportIds.has(id)) {
				seenImportIds.add(id)
				const cId = contentId({
					normalizedSignature: normalizeSignature(imp.specifier),
					normalizedBody: normalizeBody(imp.bodyText),
				})
				nodes.push(
					GraphNodeSchema.parse({
						id,
						contentHash: cId,
						repoId: args.repoId,
						indexRunId: args.indexRunId,
						batchId: args.batchId,
						sourcePath: args.path,
						schemaVersion: SCHEMA_VERSION,
						path: args.path,
						kind: "Import",
						language: args.language,
						qualifiedName,
						signature: imp.specifier,
						evidence: {
							startLine: imp.startLine,
							endLine: imp.endLine,
						},
					}),
				)
				edges.push(
					GraphEdgeSchema.parse({
						src: fileNodeId,
						dst: id,
						type: "CONTAINS",
						repoId: args.repoId,
						indexRunId: args.indexRunId,
						batchId: args.batchId,
						sourcePath: args.path,
						contentHash: edgeContentHash({
							src: fileNodeId,
							type: "CONTAINS",
							dst: id,
						}),
						schemaVersion: SCHEMA_VERSION,
					}),
				)
				edges.push(
					GraphEdgeSchema.parse({
						src: fileNodeId,
						dst: id,
						type: "IMPORTS",
						repoId: args.repoId,
						indexRunId: args.indexRunId,
						batchId: args.batchId,
						sourcePath: args.path,
						contentHash: edgeContentHash({
							src: fileNodeId,
							type: "IMPORTS",
							dst: id,
						}),
						schemaVersion: SCHEMA_VERSION,
					}),
				)
			}

			if (args.language !== "python") {
				const resolved = resolveLocalTsImport(args.path, imp.specifier)
				if (resolved) {
					const targetFileId = stableId({
						repoId: args.repoId,
						relativePath: resolved,
						symbolKind: "File",
						qualifiedName: resolved,
					})
					edges.push(
						GraphEdgeSchema.parse({
							src: fileNodeId,
							dst: targetFileId,
							type: "IMPORTS",
							repoId: args.repoId,
							indexRunId: args.indexRunId,
							batchId: args.batchId,
							sourcePath: args.path,
							contentHash: edgeContentHash({
								src: fileNodeId,
								type: "IMPORTS",
								dst: targetFileId,
							}),
							schemaVersion: SCHEMA_VERSION,
						}),
					)
				}
			}
		}

		return { nodes, edges }
	}
}
