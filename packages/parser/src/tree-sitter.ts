import { createRequire } from "node:module"
import type { GraphEdge, GraphNode, Language, NodeKind } from "@codesoul/core"
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
} from "@codesoul/core"
import type { Parser, ParseResult } from "./parser.js"

// `tree-sitter` and its grammar packages ship as CommonJS native modules.
// `createRequire` keeps this file working under `"type": "module"` regardless
// of downstream interop flags and confines the untyped binding shape here.
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

// ---- Decl extraction (Phase 2A) -------------------------------------------

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

// ---- Call extraction (Phase 2C) -------------------------------------------
//
// Naive intra-file CALLS are collected during the same tree walk that finds
// decls. For every Function/Method we recursively scan the body subtree
// (including nested arrow/lambda/expression bodies) for call sites:
//
//   - TS/JS `call_expression` with `function` = `identifier`         -> bare
//   - TS/JS `call_expression` with `function` = `member_expression`
//     where `object` is the literal `this` keyword               -> thisOrSelf
//   - Python `call` with `function` = `identifier`                   -> bare
//   - Python `call` with `function` = `attribute`
//     where `object` is the identifier `self`                    -> thisOrSelf
//
// Other shapes (`super.foo`, `obj.foo`, `f[0]()`, `(g)()`, ...) are
// intentionally ignored: naive mode never invents a target it cannot resolve
// from the in-file decl table.

type CallResolution = "bare" | "thisOrSelf"

type CallerCtx = {
	callerName: string
	callerKind: "Function" | "Method"
	callerClassName?: string
}

type CallSite = CallerCtx & {
	calleeName: string
	resolution: CallResolution
}

type CollectResult = {
	decls: Decl[]
	calls: CallSite[]
}

const collectCallsInTsBody = (
	bodyNode: SyntaxNode,
	caller: CallerCtx,
): CallSite[] => {
	const out: CallSite[] = []
	const visit = (node: SyntaxNode): void => {
		if (node.type === "call_expression") {
			const fnNode = node.childForFieldName("function")
			if (fnNode) {
				if (fnNode.type === "identifier") {
					out.push({
						...caller,
						calleeName: fnNode.text,
						resolution: "bare",
					})
				} else if (fnNode.type === "member_expression") {
					const obj = fnNode.childForFieldName("object")
					const prop = fnNode.childForFieldName("property")
					if (obj && obj.type === "this" && prop) {
						out.push({
							...caller,
							calleeName: prop.text,
							resolution: "thisOrSelf",
						})
					}
				}
			}
		}
		for (let i = 0; i < node.namedChildCount; i++) {
			const child = node.namedChild(i)
			if (child) visit(child)
		}
	}
	visit(bodyNode)
	return out
}

const collectCallsInPyBody = (
	bodyNode: SyntaxNode,
	caller: CallerCtx,
): CallSite[] => {
	const out: CallSite[] = []
	const visit = (node: SyntaxNode): void => {
		if (node.type === "call") {
			const fnNode = node.childForFieldName("function")
			if (fnNode) {
				if (fnNode.type === "identifier") {
					out.push({
						...caller,
						calleeName: fnNode.text,
						resolution: "bare",
					})
				} else if (fnNode.type === "attribute") {
					const obj = fnNode.childForFieldName("object")
					const attr = fnNode.childForFieldName("attribute")
					if (
						obj &&
						obj.type === "identifier" &&
						obj.text === "self" &&
						attr
					) {
						out.push({
							...caller,
							calleeName: attr.text,
							resolution: "thisOrSelf",
						})
					}
				}
			}
		}
		for (let i = 0; i < node.namedChildCount; i++) {
			const child = node.namedChild(i)
			if (child) visit(child)
		}
	}
	visit(bodyNode)
	return out
}

const collectTypescript = (
	root: SyntaxNode,
	source: string,
): CollectResult => {
	const decls: Decl[] = []
	const calls: CallSite[] = []
	const visit = (node: SyntaxNode, parentClassName: string | null): void => {
		const t = node.type
		if (t === "function_declaration") {
			const nameNode = node.childForFieldName("name")
			const paramsNode = node.childForFieldName("parameters")
			const bodyNode = node.childForFieldName("body")
			if (nameNode) {
				const name = nameNode.text
				decls.push({
					kind: "Function",
					name,
					signature: `${name}${paramsNode?.text ?? "()"}`,
					bodyText: source.slice(node.startIndex, node.endIndex),
					startLine: node.startPosition.row + 1,
					endLine: node.endPosition.row + 1,
				})
				if (bodyNode) {
					calls.push(
						...collectCallsInTsBody(bodyNode, {
							callerName: name,
							callerKind: "Function",
						}),
					)
				}
			}
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
			const bodyNode = node.childForFieldName("body")
			if (nameNode) {
				const name = nameNode.text
				decls.push({
					kind: "Method",
					name,
					signature: `${name}${paramsNode?.text ?? "()"}`,
					bodyText: source.slice(node.startIndex, node.endIndex),
					startLine: node.startPosition.row + 1,
					endLine: node.endPosition.row + 1,
					parentClassName,
				})
				if (bodyNode) {
					calls.push(
						...collectCallsInTsBody(bodyNode, {
							callerName: name,
							callerKind: "Method",
							callerClassName: parentClassName,
						}),
					)
				}
			}
			return
		}
		for (let i = 0; i < node.namedChildCount; i++) {
			const child = node.namedChild(i)
			if (child) visit(child, parentClassName)
		}
	}
	visit(root, null)
	return { decls, calls }
}

const collectPython = (
	root: SyntaxNode,
	source: string,
): CollectResult => {
	const decls: Decl[] = []
	const calls: CallSite[] = []
	const visit = (node: SyntaxNode, parentClassName: string | null): void => {
		const t = node.type
		if (t === "function_definition") {
			const nameNode = node.childForFieldName("name")
			const paramsNode = node.childForFieldName("parameters")
			const bodyNode = node.childForFieldName("body")
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
				if (bodyNode) {
					const caller: CallerCtx = parentClassName
						? {
								callerName: name,
								callerKind: "Method",
								callerClassName: parentClassName,
							}
						: { callerName: name, callerKind: "Function" }
					calls.push(...collectCallsInPyBody(bodyNode, caller))
				}
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
		for (let i = 0; i < node.namedChildCount; i++) {
			const child = node.namedChild(i)
			if (child) visit(child, parentClassName)
		}
	}
	visit(root, null)
	return { decls, calls }
}

const qualifiedNameFor = (path: string, decl: Decl): string => {
	if (decl.kind === "Method" && decl.parentClassName) {
		return `${path}::${decl.parentClassName}.${decl.name}`
	}
	return `${path}::${decl.name}`
}

// ---- Block extraction (Phase 7f / PR E) -----------------------------------

/** AST node types that represent logical blocks within function/method bodies. */
const TS_BLOCK_TYPES = new Set([
	"if_statement",
	"else_clause",
	"for_statement",
	"for_in_statement",
	"while_statement",
	"switch_statement",
	"try_statement",
	"catch_clause",
	"finally_clause",
	"arrow_function",
	"function_expression",
	"class_declaration",
])

const PY_BLOCK_TYPES = new Set([
	"if_statement",
	"elif_clause",
	"else_clause",
	"for_statement",
	"while_statement",
	"try_statement",
	"except_clause",
	"finally_clause",
	"with_statement",
	"match_statement",
	"case_clause",
	"function_definition",
	"class_definition",
])

type BlockInfo = {
	ordinal: number
	blockKind: string
	startLine: number
	endLine: number
	bodyText: string
}

const BLOCK_TOKEN_THRESHOLD = 512
const BLOCK_LINE_THRESHOLD = 60
const tokenEstimator = new ByteTokenEstimator()

/**
 * Collect logical child blocks from a function/method body.
 * Only invoked when the parent exceeds the token or line-span threshold.
 */
const collectBlocksFromBody = (
	bodyNode: SyntaxNode,
	source: string,
	blockTypes: ReadonlySet<string>,
): BlockInfo[] => {
	const blocks: BlockInfo[] = []
	let ordinal = 0

	const walkBody = (node: SyntaxNode): void => {
		for (let i = 0; i < node.namedChildCount; i++) {
			const child = node.namedChild(i)
			if (!child) continue
			if (blockTypes.has(child.type)) {
				blocks.push({
					ordinal: ordinal++,
					blockKind: child.type,
					startLine: child.startPosition.row + 1,
					endLine: child.endPosition.row + 1,
					bodyText: source.slice(child.startIndex, child.endIndex),
				})
				// Recursively walk into the block for nested blocks.
				walkBody(child)
			} else {
				// Walk other children (including statement_block) for nested blocks.
				walkBody(child)
			}
		}
	}

	walkBody(bodyNode)
	return blocks
}

/**
 * Determine whether block extraction should be enabled for a decl.
 * Returns true if the decl's body exceeds either the token or line threshold.
 */
const shouldExtractBlocks = (decl: Decl): boolean => {
	const lineSpan = decl.endLine - decl.startLine + 1
	if (lineSpan > BLOCK_LINE_THRESHOLD) return true
	const estimatedTokens = tokenEstimator.estimate(decl.bodyText)
	return estimatedTokens > BLOCK_TOKEN_THRESHOLD
}

// ---- Import extraction (Phase 2B) -----------------------------------------

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
						bodyText: source.slice(child.startIndex, child.endIndex),
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
	if (dotIdx <= lastSegStart) return null
	const ext = resolved.slice(dotIdx)
	const target = TS_RESOLVE_EXT[ext]
	if (!target) return null
	return `${resolved.slice(0, dotIdx)}${target}`
}

// ---- Public parser --------------------------------------------------------

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
		nodes.push(
			GraphNodeSchema.parse({
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
			}),
		)

		if (!SUPPORTED.includes(args.language)) {
			return { nodes, edges }
		}

		const parser =
			args.language === "python" ? this.pyParser : this.tsParser
		const tree = parser.parse(args.source)

		// Phase 2A decls + Phase 2C call collection happen in one walk.
		const { decls, calls } =
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
			nodes.push(
				GraphNodeSchema.parse({
					id,
					contentHash: contentId({
						normalizedSignature: normalizeSignature(decl.signature),
						normalizedBody: normalizeBody(decl.bodyText),
					}),
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
					evidence: {
						startLine: decl.startLine,
						endLine: decl.endLine,
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

			// Phase 7f / PR E: Block extraction for long functions/methods.
			if (
				(decl.kind === "Function" || decl.kind === "Method") &&
				shouldExtractBlocks(decl)
			) {
				// Find the body node from the original AST to walk for blocks.
				const blockTypes =
					args.language === "python"
						? PY_BLOCK_TYPES
						: TS_BLOCK_TYPES

				const blocks = collectBlocksFromBody(
					tree.rootNode,
					args.source,
					blockTypes,
				)

				for (const block of blocks) {
					const blockQName = `${qualifiedName}#block:${block.ordinal}:${block.blockKind}`
					const blockId = stableId({
						repoId: args.repoId,
						relativePath: args.path,
						symbolKind: "Block",
						qualifiedName: blockQName,
					})
					nodes.push(
						GraphNodeSchema.parse({
							id: blockId,
							contentHash: contentId({
								normalizedSignature: normalizeSignature(""),
								normalizedBody: normalizeBody(block.bodyText),
							}),
							repoId: args.repoId,
							indexRunId: args.indexRunId,
							batchId: args.batchId,
							sourcePath: args.path,
							schemaVersion: SCHEMA_VERSION,
							path: args.path,
							kind: "Block",
							language: args.language,
							qualifiedName: blockQName,
							signature: block.blockKind,
							evidence: {
								startLine: block.startLine,
								endLine: block.endLine,
							},
						}),
					)
					edges.push(
						GraphEdgeSchema.parse({
							src: id,
							dst: blockId,
							type: "CONTAINS",
							repoId: args.repoId,
							indexRunId: args.indexRunId,
							batchId: args.batchId,
							sourcePath: args.path,
							contentHash: edgeContentHash({
								src: id,
								type: "CONTAINS",
								dst: blockId,
							}),
							schemaVersion: SCHEMA_VERSION,
						}),
					)
				}
			}
		}

		// Phase 2B: imports + File->File resolution for TS/JS local relatives.
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
				nodes.push(
					GraphNodeSchema.parse({
						id,
						contentHash: contentId({
							normalizedSignature: normalizeSignature(imp.specifier),
							normalizedBody: normalizeBody(imp.bodyText),
						}),
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

		// Phase 2C: resolve collected call sites against the in-file decl table
		// and emit deduped CALLS edges. Self-recursion is skipped so a function
		// can never CALL itself.
		const topLevelFunctionsByName = new Map<string, GraphNode>()
		const methodsByClassName = new Map<string, Map<string, GraphNode>>()
		for (const node of nodes) {
			if (node.kind === "Function") {
				const tail = node.qualifiedName.split("::").pop() ?? ""
				topLevelFunctionsByName.set(tail, node)
			} else if (node.kind === "Method") {
				const tail = node.qualifiedName.split("::").pop() ?? ""
				const dotIdx = tail.indexOf(".")
				if (dotIdx >= 0) {
					const className = tail.slice(0, dotIdx)
					const methodName = tail.slice(dotIdx + 1)
					let m = methodsByClassName.get(className)
					if (!m) {
						m = new Map()
						methodsByClassName.set(className, m)
					}
					m.set(methodName, node)
				}
			}
		}

		const emittedCallEdges = new Set<string>()
		for (const call of calls) {
			let callerNode: GraphNode | undefined
			if (call.callerKind === "Function") {
				callerNode = topLevelFunctionsByName.get(call.callerName)
			} else if (call.callerClassName) {
				callerNode = methodsByClassName
					.get(call.callerClassName)
					?.get(call.callerName)
			}
			if (!callerNode) continue

			let calleeNode: GraphNode | undefined
			if (call.resolution === "bare") {
				calleeNode = topLevelFunctionsByName.get(call.calleeName)
			} else if (
				call.resolution === "thisOrSelf" &&
				call.callerClassName
			) {
				calleeNode = methodsByClassName
					.get(call.callerClassName)
					?.get(call.calleeName)
			}
			if (!calleeNode) continue
			if (calleeNode.id === callerNode.id) continue

			const key = `${callerNode.id}|${calleeNode.id}`
			if (emittedCallEdges.has(key)) continue
			emittedCallEdges.add(key)

			edges.push(
				GraphEdgeSchema.parse({
					src: callerNode.id,
					dst: calleeNode.id,
					type: "CALLS",
					repoId: args.repoId,
					indexRunId: args.indexRunId,
					batchId: args.batchId,
					sourcePath: args.path,
					contentHash: edgeContentHash({
						src: callerNode.id,
						type: "CALLS",
						dst: calleeNode.id,
					}),
					schemaVersion: SCHEMA_VERSION,
				}),
			)
		}

		return { nodes, edges }
	}
}
