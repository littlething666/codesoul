import { describe, expect, it } from "vitest"
import { buildProgram } from "../program.js"

describe("codesoul CLI", () => {
	it("registers the expected top-level commands", () => {
		const program = buildProgram()
		const names = program.commands.map((c) => c.name())
		expect(names).toContain("index")
		expect(names).toContain("query")
		expect(names).toContain("inspect")
		expect(names).toContain("graph")
	})

	it("the graph command exposes export", () => {
		const program = buildProgram()
		const graph = program.commands.find((c) => c.name() === "graph")
		expect(graph).toBeDefined()
		const sub = graph?.commands.map((c) => c.name()) ?? []
		expect(sub).toContain("export")
	})
})
