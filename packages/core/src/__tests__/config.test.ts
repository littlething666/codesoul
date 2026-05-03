import { describe, expect, it } from "vitest"
import { IndexConfig, defaultIndexConfig } from "../config.js"

describe("IndexConfig", () => {
	it("defaults to memory + mock everywhere", () => {
		const c = defaultIndexConfig()
		expect(c.parser).toBe("regex")
		expect(c.graphStore).toBe("memory")
		expect(c.vectorStore).toBe("memory")
		expect(c.embedder).toBe("mock")
		expect(c.reranker).toBe("mock")
		expect(c.rigExtractors).toEqual([])
		expect(c.enableSpade).toBe(false)
	})

	it("accepts an override", () => {
		const c = IndexConfig.parse({
			parser: "tree-sitter",
			rigExtractors: ["package-json", "pyproject"],
		})
		expect(c.parser).toBe("tree-sitter")
		expect(c.rigExtractors).toEqual(["package-json", "pyproject"])
	})

	it("rejects an unknown parser mode", () => {
		expect(() => IndexConfig.parse({ parser: "bogus" })).toThrow()
	})

	it("rejects an unknown rig extractor", () => {
		expect(() =>
			IndexConfig.parse({ rigExtractors: ["package-json", "bogus"] }),
		).toThrow()
	})
})
