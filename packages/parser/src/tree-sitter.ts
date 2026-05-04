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

// ---- Call extraction (Phase 2C) --------------------------------------------
//
// Naive intra-file CALLS are collected during the same tree walk that finds
// decls. For every Function/Method we recursively scan the body subtree
// (including nested arrow/lambda/expression bodies) for call sites:
//
//   - TS/JS `call_expression` with `function` = `identifier`         → bare
//   - TS/JS `call_expression` with `function` = `member_expression`
//                                where `object` is the literal `this` keyword
//                                                                  → thisOrSelf
//   - Python `call` with `function` = `identifier`                   → bare
//   - Python `call` with `function` = `attribute`
//                                where `object` is the identifier `self`
//                                                                  → thisOrSelf
//
// Other shapes (`super.foo`, `obj.foo`, `f[0]()`, `(g)()`, ...) are
// intentionally ignored — naive mode never invents a target it cannot
// resolve from the in-file decl table.

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

const withClass = (caller: CallerCtx, className: string | undefined): CallerCtx =>
	className !== undefined ? { ...caller, callerClassName: className } : caller

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
				const signature = `${name}${paramsNode?.text ?? "()"}`
				decls.push({
					kind: "Function",
					name,
					signature,
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
			// Phase 2A: do not descend into function bodies for further
			// decl extraction. Nested decls land in later splits.
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
				if (bodyNode) {
					calls.push(
						...collectCallsInTsBody(
							bodyNode,
							withClass(
								{ callerName: name, callerKind: "Method" },
								parentClassName,
							),
						),
					)
				}
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
		// Descend through module / decorated_definition / etc.
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
 * Imports always live at the program (top) level in well-formed source, so a
 * shallow scan over the program's named children is correct and noticeably
 * cheaper than a full descent. Re-exports of the form
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
 * Resolve a `./`