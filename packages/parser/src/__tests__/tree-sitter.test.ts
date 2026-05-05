import { describe, expect, it } from "vitest"
import {
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
	edgeContentHash,
	stableId,
} from "@codesoul/core"
import type { ParseResult } from "../parser.js"
import { TreeSitterParser } from "../tree-sitter.js"

const parse = async (
	language: "typescript" | "javascript" | "python",
	path: string,
	source: string,
): Promise<ParseResult> => {
	const p = new TreeSitterParser()
	return p.parseFile({
		repoId: "r",
		indexRunId: "run_test",
		batchId: "batch_test",
		path,
		language,
		source,
	})
}

const summarize = (r: ParseResult) => ({
	nodes: r.nodes.map((n) => ({
		id: n.id,
		contentHash: n.contentHash,
		kind: n.kind,
		qualifiedName: n.qualifiedName,
		signature: n.signature,
		evidence: n.evidence,
	})),
	edges: r.edges.map((e) => ({
		src: e.src,
		dst: e.dst,
		type: e.type,
		contentHash: e.contentHash,
	})),
})

describe("TreeSitterParser", () => {
	it("emits a File node for every parsed file", async () => {
		const r = await parse("typescript", "src/empty.ts", "")
		const file = r.nodes.find((n) => n.kind === "File")
		expect(file).toBeDefined()
		expect(file?.qualifiedName).toBe("src/empty.ts")
	})

	it("emits TS top-level function and class WITH method", async () => {
		const r = await parse(
			"typescript",
			"src/farewell.ts",
			`export function farewell(name: string): string {\n\treturn \`Goodbye, \${name}!\`\n}\n\nexport class Farewell {\n\tconstructor(public readonly name: string) {}\n\n\tmessage(): string {\n\t\treturn farewell(this.name)\n\t}\n}\n`,
		)
		const kinds = r.nodes.map((n) => `${n.kind}:${n.qualifiedName}`)
		expect(kinds).toContain("File:src/farewell.ts")
		expect(kinds).toContain("Function:src/farewell.ts::farewell")
		expect(kinds).toContain("Class:src/farewell.ts::Farewell")
		expect(kinds).toContain("Method:src/farewell.ts::Farewell.message")
	})

	it("emits TS greet/greetMany at top level", async () => {
		const r = await parse(
			"typescript",
			"src/greet.ts",
			`export function greet(name: string): string {\n\treturn \`Hello, \${name}!\`\n}\n\nexport function greetMany(names: string[]): string[] {\n\treturn names.map((n) => greet(n))\n}\n`,
		)
		const kinds = r.nodes.map((n) => `${n.kind}:${n.qualifiedName}`)
		expect(kinds).toContain("Function:src/greet.ts::greet")
		expect(kinds).toContain("Function:src/greet.ts::greetMany")
	})

	it("emits Import nodes (no Class/Function/Method) for re-export indexes", async () => {
		const r = await parse(
			"typescript",
			"src/index.ts",
			`export { greet, greetMany } from "./greet.js"\nexport { farewell, Farewell } from "./farewell.js"\n`,
		)
		const kinds = r.nodes.map((n) => n.kind).sort()
		expect(kinds).toEqual(["File", "Import", "Import"])
		const importSpecs = r.nodes
			.filter((n) => n.kind === "Import")
			.map((n) => n.signature)
			.sort()
		expect(importSpecs).toEqual(["./farewell.js", "./greet.js"])
	})

	it("emits Python top-level def/class AND every method", async () => {
		const r = await parse(
			"python",
			"src/greet.py",
			`def greet(name: str) -> str:\n    return f"Hello, {name}!"\n\n\nclass Greeter:\n    def __init__(self, name: str) -> None:\n        self.name = name\n\n    def message(self) -> str:\n        return greet(self.name)\n`,
		)
		const kinds = r.nodes.map((n) => `${n.kind}:${n.qualifiedName}`)
		expect(kinds).toContain("File:src/greet.py")
		expect(kinds).toContain("Function:src/greet.py::greet")
		expect(kinds).toContain("Class:src/greet.py::Greeter")
		expect(kinds).toContain("Method:src/greet.py::Greeter.__init__")
		expect(kinds).toContain("Method:src/greet.py::Greeter.message")
		expect(kinds).not.toContain("Function:src/greet.py::__init__")
		expect(kinds).not.toContain("Function:src/greet.py::message")
	})

	it("emits CONTAINS edges from File to every decl with edgeContentHash", async () => {
		const r = await parse(
			"typescript",
			"src/x.ts",
			`export function a() {}\nexport class B { m() {} }\n`,
		)
		const file = r.nodes.find((n) => n.kind === "File")
		expect(file).toBeDefined()
		if (!file) return
		const decls = r.nodes.filter(
			(n) =>
				n.kind === "Class" ||
				n.kind === "Function" ||
				n.kind === "Method",
		)
		expect(decls.length).toBeGreaterThanOrEqual(3)
		for (const decl of decls) {
			const edge = r.edges.find(
				(e) =>
					e.src === file.id &&
					e.dst === decl.id &&
					e.type === "CONTAINS",
			)
			expect(edge).toBeDefined()
			if (!edge) continue
			expect(edge.contentHash).toBe(
				edgeContentHash({
					src: edge.src,
					type: edge.type,
					dst: edge.dst,
				}),
			)
		}
	})

	it("validates every emitted node and edge against the schemas", async () => {
		const r = await parse(
			"typescript",
			"src/farewell.ts",
			`export function farewell(name: string): string { return name }\nexport class Farewell { hi() { return 1 } }\n`,
		)
		for (const n of r.nodes) GraphNodeSchema.parse(n)
		for (const e of r.edges) GraphEdgeSchema.parse(e)
	})

	it("is deterministic on identical inputs", async () => {
		const src = `export function x() {}\nexport class Y { z() {} }\n`
		const a = await parse("typescript", "src/a.ts", src)
		const b = await parse("typescript", "src/a.ts", src)
		expect(summarize(a)).toEqual(summarize(b))
	})

	it("distinguishes same-named methods on different classes by id", async () => {
		const r = await parse(
			"typescript",
			"src/dup.ts",
			`export class A { run() {} }\nexport class B { run() {} }\n`,
		)
		const methods = r.nodes.filter((n) => n.kind === "Method")
		expect(methods).toHaveLength(2)
		expect(methods[0]?.id).not.toBe(methods[1]?.id)
		const qns = methods.map((m) => m.qualifiedName).sort()
		expect(qns).toEqual(["src/dup.ts::A.run", "src/dup.ts::B.run"])
	})

	it("evidence covers the full body line range", async () => {
		const r = await parse(
			"typescript",
			"src/multiline.ts",
			`export function f() {\n\tconst a = 1\n\tconst b = 2\n\treturn a + b\n}\n`,
		)
		const fn = r.nodes.find((n) => n.kind === "Function")
		expect(fn).toBeDefined()
		expect(fn?.evidence.startLine).toBe(1)
		expect(fn?.evidence.endLine).toBe(5)
	})

	it("unsupported language still emits a File node, no decls", async () => {
		const p = new TreeSitterParser()
		const r = await p.parseFile({
			repoId: "r",
			indexRunId: "run_test",
			batchId: "batch_test",
			path: "README.md",
			language: "markdown",
			source: "# hello\n",
		})
		expect(r.nodes.map((n) => n.kind)).toEqual(["File"])
		expect(r.edges).toHaveLength(0)
	})
})

describe("TreeSitterParser imports (Phase 2B)", () => {
	it("emits an Import node and IMPORTS edge for a TS import statement", async () => {
		const r = await parse(
			"typescript",
			"src/index.ts",
			`import { greet } from "./greet.js"\n`,
		)
		const importNode = r.nodes.find((n) => n.kind === "Import")
		expect(importNode).toBeDefined()
		expect(importNode?.qualifiedName).toBe(
			"src/index.ts::import:./greet.js",
		)
		expect(importNode?.signature).toBe("./greet.js")
		const fileNode = r.nodes.find((n) => n.kind === "File")
		expect(fileNode).toBeDefined()
		if (!fileNode || !importNode) return
		const importsEdge = r.edges.find(
			(e) =>
				e.src === fileNode.id &&
				e.dst === importNode.id &&
				e.type === "IMPORTS",
		)
		expect(importsEdge).toBeDefined()
		const containsEdge = r.edges.find(
			(e) =>
				e.src === fileNode.id &&
				e.dst === importNode.id &&
				e.type === "CONTAINS",
		)
		expect(containsEdge).toBeDefined()
	})

	it("treats `export ... from` re-exports as imports", async () => {
		const r = await parse(
			"typescript",
			"src/index.ts",
			`export { greet } from "./greet.js"\nexport { farewell } from "./farewell.js"\n`,
		)
		const importSpecs = r.nodes
			.filter((n) => n.kind === "Import")
			.map((n) => n.signature)
			.sort()
		expect(importSpecs).toEqual(["./farewell.js", "./greet.js"])
	})

	it("resolves TS local relative imports to a File->File IMPORTS edge", async () => {
		const r = await parse(
			"typescript",
			"src/index.ts",
			`import { greet } from "./greet.js"\n`,
		)
		const fileNode = r.nodes.find((n) => n.kind === "File")
		expect(fileNode).toBeDefined()
		if (!fileNode) return
		const greetFileId = stableId({
			repoId: "r",
			relativePath: "src/greet.ts",
			symbolKind: "File",
			qualifiedName: "src/greet.ts",
		})
		const fileToFileEdge = r.edges.find(
			(e) =>
				e.src === fileNode.id &&
				e.dst === greetFileId &&
				e.type === "IMPORTS",
		)
		expect(fileToFileEdge).toBeDefined()
		expect(fileToFileEdge?.contentHash).toBe(
			edgeContentHash({
				src: fileNode.id,
				type: "IMPORTS",
				dst: greetFileId,
			}),
		)
		const greetParse = await parse("typescript", "src/greet.ts", "")
		expect(greetParse.nodes[0]?.id).toBe(greetFileId)
	})

	it("resolves `../` parent imports relative to the source file's directory", async () => {
		const r = await parse(
			"typescript",
			"src/sub/x.ts",
			`import { y } from "../y.js"\n`,
		)
		const fileNode = r.nodes.find((n) => n.kind === "File")
		expect(fileNode).toBeDefined()
		if (!fileNode) return
		const yFileId = stableId({
			repoId: "r",
			relativePath: "src/y.ts",
			symbolKind: "File",
			qualifiedName: "src/y.ts",
		})
		expect(
			r.edges.some(
				(e) =>
					e.src === fileNode.id &&
					e.dst === yFileId &&
					e.type === "IMPORTS",
			),
		).toBe(true)
	})

	it("does NOT emit a File->File edge for bare TS module specifiers", async () => {
		const r = await parse(
			"typescript",
			"src/x.ts",
			`import * as React from "react"\n`,
		)
		const importNode = r.nodes.find((n) => n.kind === "Import")
		expect(importNode).toBeDefined()
		if (!importNode) return
		const importsEdges = r.edges.filter((e) => e.type === "IMPORTS")
		expect(importsEdges.length).toBe(1)
		expect(importsEdges[0]?.dst).toBe(importNode.id)
	})

	it("does NOT emit a File->File edge for extensionless / directory specifiers", async () => {
		const r = await parse(
			"typescript",
			"src/x.ts",
			`import { y } from "./y"\n`,
		)
		const importNode = r.nodes.find((n) => n.kind === "Import")
		expect(importNode).toBeDefined()
		if (!importNode) return
		const importsEdges = r.edges.filter((e) => e.type === "IMPORTS")
		expect(importsEdges.length).toBe(1)
		expect(importsEdges[0]?.dst).toBe(importNode.id)
	})

	it("emits a Python Import node for `import os`", async () => {
		const r = await parse("python", "src/x.py", `import os\n`)
		const importNodes = r.nodes.filter((n) => n.kind === "Import")
		expect(importNodes).toHaveLength(1)
		expect(importNodes[0]?.qualifiedName).toBe("src/x.py::import:os")
	})

	it("emits one Python Import per name in `import os, sys`", async () => {
		const r = await parse("python", "src/x.py", `import os, sys\n`)
		const specs = r.nodes
			.filter((n) => n.kind === "Import")
			.map((n) => n.signature)
			.sort()
		expect(specs).toEqual(["os", "sys"])
	})

	it("emits a single Python Import for `from foo import bar, baz`", async () => {
		const r = await parse(
			"python",
			"src/x.py",
			`from foo import bar, baz\n`,
		)
		const importNodes = r.nodes.filter((n) => n.kind === "Import")
		expect(importNodes).toHaveLength(1)
		expect(importNodes[0]?.qualifiedName).toBe("src/x.py::import:foo")
	})

	it("does NOT emit File->File edges for any Python imports", async () => {
		const r = await parse(
			"python",
			"src/x.py",
			`import os\nfrom foo import bar\n`,
		)
		const importNodes = r.nodes.filter((n) => n.kind === "Import")
		const importNodeIds = new Set(importNodes.map((n) => n.id))
		const importsEdges = r.edges.filter((e) => e.type === "IMPORTS")
		for (const e of importsEdges) {
			expect(importNodeIds.has(e.dst)).toBe(true)
		}
	})

	it("dedupes duplicate same-specifier imports within a file", async () => {
		const r = await parse(
			"typescript",
			"src/x.ts",
			`import { a } from "./a.js"\nimport { b } from "./a.js"\n`,
		)
		const importNodes = r.nodes.filter((n) => n.kind === "Import")
		expect(importNodes).toHaveLength(1)
	})

	it("validates Import nodes and IMPORTS edges against the schemas", async () => {
		const r = await parse(
			"typescript",
			"src/x.ts",
			`import { greet } from "./greet.js"\nimport * as React from "react"\n`,
		)
		for (const n of r.nodes) GraphNodeSchema.parse(n)
		for (const e of r.edges) GraphEdgeSchema.parse(e)
	})
})

describe("TreeSitterParser intra-file CALLS (Phase 2C)", () => {
	it("emits a CALLS edge between top-level TS functions calling each other", async () => {
		const r = await parse(
			"typescript",
			"src/greet.ts",
			`export function greet(name: string): string { return name }\nexport function greetMany(names: string[]): string[] { return names.map((n) => greet(n)) }\n`,
		)
		const greet = r.nodes.find(
			(n) => n.qualifiedName === "src/greet.ts::greet",
		)
		const greetMany = r.nodes.find(
			(n) => n.qualifiedName === "src/greet.ts::greetMany",
		)
		expect(greet).toBeDefined()
		expect(greetMany).toBeDefined()
		if (!greet || !greetMany) return
		const callsEdge = r.edges.find(
			(e) =>
				e.src === greetMany.id &&
				e.dst === greet.id &&
				e.type === "CALLS",
		)
		expect(callsEdge).toBeDefined()
		expect(callsEdge?.contentHash).toBe(
			edgeContentHash({
				src: greetMany.id,
				type: "CALLS",
				dst: greet.id,
			}),
		)
	})

	it("emits a CALLS edge from a TS method to a top-level function", async () => {
		const r = await parse(
			"typescript",
			"src/farewell.ts",
			`export function farewell(name: string): string { return name }\nexport class Farewell {\n\tmessage(): string { return farewell("x") }\n}\n`,
		)
		const farewell = r.nodes.find(
			(n) => n.qualifiedName === "src/farewell.ts::farewell",
		)
		const method = r.nodes.find(
			(n) => n.qualifiedName === "src/farewell.ts::Farewell.message",
		)
		expect(farewell).toBeDefined()
		expect(method).toBeDefined()
		if (!farewell || !method) return
		expect(
			r.edges.some(
				(e) =>
					e.src === method.id &&
					e.dst === farewell.id &&
					e.type === "CALLS",
			),
		).toBe(true)
	})

	it("emits a CALLS edge from a TS method to another method on the same class via this.foo", async () => {
		const r = await parse(
			"typescript",
			"src/c.ts",
			`export class C {\n\thelper(): string { return "x" }\n\tmain(): string { return this.helper() }\n}\n`,
		)
		const helper = r.nodes.find(
			(n) => n.qualifiedName === "src/c.ts::C.helper",
		)
		const main = r.nodes.find(
			(n) => n.qualifiedName === "src/c.ts::C.main",
		)
		expect(helper).toBeDefined()
		expect(main).toBeDefined()
		if (!helper || !main) return
		expect(
			r.edges.some(
				(e) =>
					e.src === main.id &&
					e.dst === helper.id &&
					e.type === "CALLS",
			),
		).toBe(true)
	})

	it("does NOT cross-contaminate same-named methods across classes", async () => {
		const r = await parse(
			"typescript",
			"src/d.ts",
			`export class A {\n\trun(): void {}\n\tcaller(): void { this.run() }\n}\nexport class B {\n\trun(): void {}\n}\n`,
		)
		const aRun = r.nodes.find(
			(n) => n.qualifiedName === "src/d.ts::A.run",
		)
		const bRun = r.nodes.find(
			(n) => n.qualifiedName === "src/d.ts::B.run",
		)
		const caller = r.nodes.find(
			(n) => n.qualifiedName === "src/d.ts::A.caller",
		)
		expect(aRun && bRun && caller).toBeTruthy()
		if (!aRun || !bRun || !caller) return
		expect(
			r.edges.some(
				(e) =>
					e.src === caller.id &&
					e.dst === aRun.id &&
					e.type === "CALLS",
			),
		).toBe(true)
		expect(
			r.edges.some(
				(e) =>
					e.src === caller.id &&
					e.dst === bRun.id &&
					e.type === "CALLS",
			),
		).toBe(false)
	})

	it("does NOT emit a CALLS edge for unresolved bare TS names (library calls)", async () => {
		const r = await parse(
			"typescript",
			"src/x.ts",
			`export function f() {\n\tconsole.log("x")\n\tArray.from([])\n}\n`,
		)
		const callsEdges = r.edges.filter((e) => e.type === "CALLS")
		expect(callsEdges).toHaveLength(0)
	})

	it("does NOT emit a self-call CALLS edge for direct recursion", async () => {
		const r = await parse(
			"typescript",
			"src/r.ts",
			`export function f(n: number): number { return n <= 0 ? 0 : f(n - 1) + 1 }\n`,
		)
		const callsEdges = r.edges.filter((e) => e.type === "CALLS")
		expect(callsEdges).toHaveLength(0)
	})

	it("dedupes multiple call sites between same caller and callee", async () => {
		const r = await parse(
			"typescript",
			"src/m.ts",
			`export function a() {}\nexport function b() { a(); a(); a() }\n`,
		)
		const callsEdges = r.edges.filter((e) => e.type === "CALLS")
		expect(callsEdges).toHaveLength(1)
	})

	it("emits a CALLS edge between top-level Python functions", async () => {
		const r = await parse(
			"python",
			"src/p.py",
			`def helper():\n    return 1\n\ndef main():\n    return helper()\n`,
		)
		const helper = r.nodes.find(
			(n) => n.qualifiedName === "src/p.py::helper",
		)
		const main = r.nodes.find(
			(n) => n.qualifiedName === "src/p.py::main",
		)
		expect(helper && main).toBeTruthy()
		if (!helper || !main) return
		expect(
			r.edges.some(
				(e) =>
					e.src === main.id &&
					e.dst === helper.id &&
					e.type === "CALLS",
			),
		).toBe(true)
	})

	it("emits a CALLS edge from a Python method to another method on the same class via self.foo", async () => {
		const r = await parse(
			"python",
			"src/q.py",
			`class C:\n    def helper(self):\n        return 1\n    def main(self):\n        return self.helper()\n`,
		)
		const helper = r.nodes.find(
			(n) => n.qualifiedName === "src/q.py::C.helper",
		)
		const main = r.nodes.find(
			(n) => n.qualifiedName === "src/q.py::C.main",
		)
		expect(helper && main).toBeTruthy()
		if (!helper || !main) return
		expect(
			r.edges.some(
				(e) =>
					e.src === main.id &&
					e.dst === helper.id &&
					e.type === "CALLS",
			),
		).toBe(true)
	})

	it("validates CALLS edges against the GraphEdge schema", async () => {
		const r = await parse(
			"typescript",
			"src/s.ts",
			`export function a() {}\nexport function b() { a() }\n`,
		)
		for (const e of r.edges) GraphEdgeSchema.parse(e)
		const callsEdges = r.edges.filter((e) => e.type === "CALLS")
		expect(callsEdges.length).toBe(1)
	})
})

// Build a TS function body whose line span exceeds the default block
// extraction line threshold (60). The body is a single big if-statement so
// the trigger fires (lineSpan > 60) and exactly one Block is emitted.
const buildLargeIfFunction = (name: string): string => {
	const stmts = Array.from({ length: 80 }, (_, i) => `\t\tx = x + ${i}`).join(
		"\n",
	)
	return `export function ${name}(x: number): number {\n\tif (x > 0) {\n${stmts}\n\t}\n\treturn x\n}\n`
}

describe("TreeSitterParser block extraction (Phase 7)", () => {
	it("emits ZERO Block nodes for small functions under default thresholds", async () => {
		const r = await parse(
			"typescript",
			"src/small.ts",
			`export function f(x: number) { if (x > 0) { return 1 } return 0 }\n`,
		)
		const blocks = r.nodes.filter((n) => n.kind === "Block")
		expect(blocks).toHaveLength(0)
	})

	it("emits Block nodes when the function body line span exceeds the default threshold", async () => {
		const src = buildLargeIfFunction("big")
		const r = await parse("typescript", "src/large.ts", src)
		const blocks = r.nodes.filter((n) => n.kind === "Block")
		expect(blocks.length).toBeGreaterThanOrEqual(1)
		const firstBlock = blocks[0]
		expect(firstBlock?.signature).toBe("if")
		expect(firstBlock?.qualifiedName).toBe(
			"src/large.ts::big#block:0",
		)
		const fn = r.nodes.find(
			(n) =>
				n.kind === "Function" && n.qualifiedName === "src/large.ts::big",
		)
		expect(fn).toBeDefined()
		if (!fn || !firstBlock) return
		const contains = r.edges.find(
			(e) =>
				e.src === fn.id &&
				e.dst === firstBlock.id &&
				e.type === "CONTAINS",
		)
		expect(contains).toBeDefined()
	})

	it("respects a custom small token threshold", async () => {
		const { TreeSitterParser: TSP } = await import("../tree-sitter.js")
		const p = new TSP({ blockExtraction: { tokenThreshold: 1, lineThreshold: 1 } })
		const r = await p.parseFile({
			repoId: "r",
			indexRunId: "run_test",
			batchId: "batch_test",
			path: "src/tiny.ts",
			language: "typescript",
			source: `export function tiny(x: number) { if (x) { return 1 } for (const y of [1]) { } return 0 }\n`,
		})
		const blocks = r.nodes.filter((n) => n.kind === "Block")
		expect(blocks.length).toBeGreaterThanOrEqual(2)
		const sigs = blocks.map((b) => b.signature)
		expect(sigs).toContain("if")
		expect(sigs).toContain("for")
	})

	it("is deterministic across runs for Block ordinals and ids", async () => {
		const src = buildLargeIfFunction("f")
		const a = await parse("typescript", "src/x.ts", src)
		const b = await parse("typescript", "src/x.ts", src)
		const toIds = (r: ParseResult) =>
			r.nodes
				.filter((n) => n.kind === "Block")
				.map((n) => n.id)
		expect(toIds(a)).toEqual(toIds(b))
	})

	it("distinguishes same-named methods on different classes by Block id", async () => {
		const { TreeSitterParser: TSP } = await import("../tree-sitter.js")
		const p = new TSP({ blockExtraction: { tokenThreshold: 1, lineThreshold: 1 } })
		const r = await p.parseFile({
			repoId: "r",
			indexRunId: "run_test",
			batchId: "batch_test",
			path: "src/dup.ts",
			language: "typescript",
			source: `export class A {\n\trun(x: number) { if (x) { return 1 } return 0 }\n}\nexport class B {\n\trun(x: number) { if (x) { return 2 } return 0 }\n}\n`,
		})
		const blocks = r.nodes.filter((n) => n.kind === "Block")
		expect(blocks).toHaveLength(2)
		expect(blocks[0]?.id).not.toBe(blocks[1]?.id)
		const qns = blocks.map((b) => b.qualifiedName).sort()
		expect(qns).toEqual([
			"src/dup.ts::A.run#block:0",
			"src/dup.ts::B.run#block:0",
		])
	})

	it("emits Block CONTAINS edges with correct edgeContentHash", async () => {
		const src = buildLargeIfFunction("big")
		const r = await parse("typescript", "src/y.ts", src)
		const fn = r.nodes.find(
			(n) => n.kind === "Function" && n.qualifiedName === "src/y.ts::big",
		)
		const block = r.nodes.find((n) => n.kind === "Block")
		expect(fn && block).toBeTruthy()
		if (!fn || !block) return
		const edge = r.edges.find(
			(e) =>
				e.src === fn.id && e.dst === block.id && e.type === "CONTAINS",
		)
		expect(edge).toBeDefined()
		expect(edge?.contentHash).toBe(
			edgeContentHash({
				src: fn.id,
				type: "CONTAINS",
				dst: block.id,
			}),
		)
	})

	it("validates Block nodes and CONTAINS edges against the schemas", async () => {
		const src = buildLargeIfFunction("f")
		const r = await parse("typescript", "src/z.ts", src)
		for (const n of r.nodes) GraphNodeSchema.parse(n)
		for (const e of r.edges) GraphEdgeSchema.parse(e)
	})
})
