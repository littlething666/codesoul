import { describe, expect, it } from "vitest"
import {
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
	edgeContentHash,
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
		// Phase 2A — methods ARE emitted (this is the headline difference
		// vs MockParser).
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

	it("emits only the File node for re-export indexes", async () => {
		const r = await parse(
			"typescript",
			"src/index.ts",
			`export { greet, greetMany } from \"./greet.js\"\nexport { farewell, Farewell } from \"./farewell.js\"\n`,
		)
		const kinds = r.nodes.map((n) => n.kind)
		expect(kinds).toEqual(["File"])
	})

	it("emits Python top-level def/class AND every method", async () => {
		const r = await parse(
			"python",
			"src/greet.py",
			`def greet(name: str) -> str:\n    return f\"Hello, {name}!\"\n\n\nclass Greeter:\n    def __init__(self, name: str) -> None:\n        self.name = name\n\n    def message(self) -> str:\n        return greet(self.name)\n`,
		)
		const kinds = r.nodes.map((n) => `${n.kind}:${n.qualifiedName}`)
		expect(kinds).toContain("File:src/greet.py")
		expect(kinds).toContain("Function:src/greet.py::greet")
		expect(kinds).toContain("Class:src/greet.py::Greeter")
		expect(kinds).toContain("Method:src/greet.py::Greeter.__init__")
		expect(kinds).toContain("Method:src/greet.py::Greeter.message")
		// Methods must NOT also appear as top-level Functions.
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
		const decls = r.nodes.filter((n) => n.kind !== "File")
		expect(decls.length).toBeGreaterThanOrEqual(3) // a, B, B.m
		for (const decl of decls) {
			const edge = r.edges.find(
				(e) => e.src === file.id && e.dst === decl.id,
			)
			expect(edge).toBeDefined()
			if (!edge) continue
			expect(edge.type).toBe("CONTAINS")
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
