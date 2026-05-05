import { describe, expect, it } from "vitest"
import { MockParser } from "@codesoul/parser/mock"
import { TreeSitterParser } from "@codesoul/parser/tree-sitter"
import { buildBatch } from "../build-batch.js"

const greetTs = `export function greet(name: string): string {\n\treturn \`Hello, \${name}!\`\n}\n\nexport function greetMany(names: string[]): string[] {\n\treturn names.map((n) => greet(n))\n}\n`

// Build a function whose body's line span exceeds the default Block line
// threshold (60) so Block extraction fires. Single big if-statement so we
// know exactly one top-level Block is emitted.
const buildLargeFunction = (name: string): string => {
	const stmts = Array.from({ length: 80 }, (_, i) => `\t\tx = x + ${i}`).join(
		"\n",
	)
	return `export function ${name}(x: number): number {\n\tif (x > 0) {\n${stmts}\n\t}\n\treturn x\n}\n`
}

describe("buildBatch", () => {
	it("is filesystem-free and deterministic for the same input", async () => {
		const parser = new MockParser()
		const input = {
			repoId: "r",
			indexRunId: "run_t",
			batchId: "batch_t",
			files: [
				{ path: "src/greet.ts", language: "typescript" as const, source: greetTs },
			],
		}
		const a = await buildBatch(parser, input)
		const b = await buildBatch(parser, input)
		expect(a).toEqual(b)
		expect(a.nodes.length).toBeGreaterThan(0)
		expect(a.vectorInputs.length).toBeGreaterThan(0)
		for (const v of a.vectorInputs) {
			expect(v.kind).toBe("node")
			if (v.kind === "node") {
				expect(v.payloadKind).toBe("FunctionSummary")
			}
		}
	})

	it("emits one EmbedInput per Function/Method/Class node", async () => {
		const parser = new MockParser()
		const result = await buildBatch(parser, {
			repoId: "r",
			indexRunId: "run_t",
			batchId: "batch_t",
			files: [
				{ path: "src/greet.ts", language: "typescript", source: greetTs },
			],
		})
		const embeddable = result.nodes.filter(
			(n) => n.kind === "Function" || n.kind === "Method" || n.kind === "Class",
		)
		expect(result.vectorInputs.length).toBe(embeddable.length)
	})

	it("skips files in unsupported languages", async () => {
		const parser = new MockParser()
		const result = await buildBatch(parser, {
			repoId: "r",
			indexRunId: "run_t",
			batchId: "batch_t",
			files: [
				{ path: "README.md", language: "markdown", source: "# hi" },
			],
		})
		expect(result.nodes).toEqual([])
		expect(result.edges).toEqual([])
		expect(result.vectorInputs).toEqual([])
	})
})

describe("buildBatch Block emission (Phase 7)", () => {
	it("emits ZERO Block EmbedInputs for small files (under default thresholds)", async () => {
		const parser = new TreeSitterParser()
		const result = await buildBatch(parser, {
			repoId: "r",
			indexRunId: "run_t",
			batchId: "batch_t",
			files: [
				{ path: "src/greet.ts", language: "typescript", source: greetTs },
			],
		})
		const blockInputs = result.vectorInputs.filter(
			(v) => v.kind === "node" && v.payloadKind === "Block",
		)
		expect(blockInputs).toHaveLength(0)
	})

	it("emits one Block EmbedInput per Block node when the trigger fires", async () => {
		const parser = new TreeSitterParser()
		const src = buildLargeFunction("big")
		const result = await buildBatch(parser, {
			repoId: "r",
			indexRunId: "run_t",
			batchId: "batch_t",
			files: [{ path: "src/large.ts", language: "typescript", source: src }],
		})
		const blockNodes = result.nodes.filter((n) => n.kind === "Block")
		const blockInputs = result.vectorInputs.filter(
			(v) => v.kind === "node" && v.payloadKind === "Block",
		)
		expect(blockNodes.length).toBeGreaterThanOrEqual(1)
		expect(blockInputs.length).toBe(blockNodes.length)
		for (const v of blockInputs) {
			if (v.kind !== "node") continue
			const match = blockNodes.find((n) => n.id === v.nodeId)
			expect(match).toBeDefined()
			if (!match) continue
			expect(v.contentHash).toBe(match.contentHash)
			expect(v.text.startsWith(`${match.qualifiedName}\n${match.signature}\n`)).toBe(
				true,
			)
			expect(match.qualifiedName).toMatch(/#block:\d+$/)
		}
	})

	it("vectorInputs ordering is deterministic across runs", async () => {
		const parser = new TreeSitterParser()
		const src = buildLargeFunction("f")
		const input = {
			repoId: "r",
			indexRunId: "run_t",
			batchId: "batch_t",
			files: [{ path: "src/x.ts", language: "typescript" as const, source: src }],
		}
		const a = await buildBatch(parser, input)
		const b = await buildBatch(parser, input)
		const keyOf = (v: (typeof a.vectorInputs)[number]) =>
			v.kind === "node"
				? `${v.payloadKind}|${v.nodeId}|${v.contentHash}`
				: `q|${v.text}`
		expect(a.vectorInputs.map(keyOf)).toEqual(b.vectorInputs.map(keyOf))
	})

	it("FunctionSummary EmbedInputs are still emitted alongside Block ones", async () => {
		const parser = new TreeSitterParser()
		const src = buildLargeFunction("f")
		const result = await buildBatch(parser, {
			repoId: "r",
			indexRunId: "run_t",
			batchId: "batch_t",
			files: [{ path: "src/x.ts", language: "typescript", source: src }],
		})
		const fnSummaries = result.vectorInputs.filter(
			(v) => v.kind === "node" && v.payloadKind === "FunctionSummary",
		)
		const blockInputs = result.vectorInputs.filter(
			(v) => v.kind === "node" && v.payloadKind === "Block",
		)
		expect(fnSummaries.length).toBeGreaterThanOrEqual(1)
		expect(blockInputs.length).toBeGreaterThanOrEqual(1)
	})
})
