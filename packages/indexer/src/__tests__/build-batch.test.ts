import { describe, expect, it } from "vitest"
import { MockParser } from "@codesoul/parser/mock"
import { buildBatch } from "../build-batch.js"

const greetTs = `export function greet(name: string): string {\n\treturn \`Hello, \${name}!\`\n}\n\nexport function greetMany(names: string[]): string[] {\n\treturn names.map((n) => greet(n))\n}\n`

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
