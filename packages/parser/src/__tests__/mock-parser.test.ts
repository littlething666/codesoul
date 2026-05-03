import { describe, expect, it } from "vitest"
import {
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
	edgeContentHash,
} from "@codesoul/core"
import type { ParseResult } from "../parser.js"
import { MockParser } from "../mock.js"

const parse = async (
	language: "typescript" | "javascript" | "python",
	path: string,
	source: string,
): Promise<ParseResult> => {
	const p = new MockParser()
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
		kind: n.kind,
		qualifiedName: n.qualifiedName,
		signature: n.signature,
	})),
	edges: r.edges.map((e) => ({ src: e.src, type: e.type, dst: e.dst })),
})

describe("MockParser", () => {
	it("emits a File node for every parsed file", async () => {
		const r = await parse("typescript", "src/empty.ts", "")
		expect(r.nodes.find((n) => n.kind === "File")).toBeDefined()
	})

	it("emits TS function declarations and a Class", async () => {
		const r = await parse(
			"typescript",
			"src/farewell.ts",
			`export function farewell(name: string): string {\n\treturn \`Goodbye, \${name}!\`\n}\n\nexport class Farewell {\n\tconstructor(public readonly name: string) {}\n\n\tmessage(): string {\n\t\treturn farewell(this.name)\n\t}\n}\n`,
		)
		const kinds = r.nodes.map((n) => `${n.kind}:${n.qualifiedName}`)
		expect(kinds).toContain("File:src/farewell.ts")
		expect(kinds).toContain("Function:src/farewell.ts::farewell")
		expect(kinds).toContain("Class:src/farewell.ts::Farewell")
		// Phase 0 contract: methods are NOT emitted.
		expect(kinds).not.toContain("Function:src/farewell.ts::message")
		expect(kinds).not.toContain("Method:src/farewell.ts::message")
	})

	it("emits TS greet/greetMany", async () => {
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

	it("emits Python top-level def and class only", async () => {
		const r = await parse(
			"python",
			"src/greet.py",
			`def greet(name: str) -> str:\n    return f\"Hello, {name}!\"\n\n\nclass Greeter:\n    def __init__(self, name: str) -> None:\n        self.name = name\n\n    def message(self) -> str:\n        return greet(self.name)\n`,
		)
		const kinds = r.nodes.map((n) => `${n.kind}:${n.qualifiedName}`)
		expect(kinds).toContain("File:src/greet.py")
		expect(kinds).toContain("Function:src/greet.py::greet")
		expect(kinds).toContain("Class:src/greet.py::Greeter")
		// Indented methods are NOT emitted.
		expect(kinds).not.toContain("Function:src/greet.py::__init__")
		expect(kinds).not.toContain("Function:src/greet.py::message")
	})

	it("validates all emitted nodes and edges as schemas", async () => {
		const r = await parse(
			"typescript",
			"src/farewell.ts",
			`export function farewell(name: string): string { return name }\nexport class Farewell {}\n`,
		)
		for (const n of r.nodes) GraphNodeSchema.parse(n)
		for (const e of r.edges) GraphEdgeSchema.parse(e)
	})

	it("CONTAINS edge contentHash uses edgeContentHash(src,type,dst)", async () => {
		const r = await parse(
			"typescript",
			"src/x.ts",
			`export function x() {}\n`,
		)
		const edge = r.edges.find((e) => e.type === "CONTAINS")
		expect(edge).toBeDefined()
		if (!edge) return
		expect(edge.contentHash).toBe(
			edgeContentHash({ src: edge.src, type: edge.type, dst: edge.dst }),
		)
	})

	it("is deterministic on identical inputs", async () => {
		const src = `export function x() {}\nexport class Y {}\n`
		const a = await parse("typescript", "src/a.ts", src)
		const b = await parse("typescript", "src/a.ts", src)
		expect(summarize(a)).toEqual(summarize(b))
	})
})
