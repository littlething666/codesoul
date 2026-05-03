import { describe, expect, it } from "vitest"
import { RigGraph } from "@codesoul/core"
import { MockRigExtractor } from "../mock.js"

describe("MockRigExtractor", () => {
	it("canExtract is true for any path", async () => {
		const r = new MockRigExtractor()
		expect(await r.canExtract("/anything")).toBe(true)
	})

	it("emits a schemaVersion 1 graph with a root component", async () => {
		const r = new MockRigExtractor()
		const g = await r.extract("/anything")
		expect(g.schemaVersion).toBe(1)
		expect(g.components.length).toBeGreaterThan(0)
	})

	it("output passes the RigGraph schema", async () => {
		const r = new MockRigExtractor()
		const g = await r.extract("/anything")
		expect(() => RigGraph.parse(g)).not.toThrow()
	})

	it("is deterministic", async () => {
		const r = new MockRigExtractor()
		const a = await r.extract("/anything")
		const b = await r.extract("/anything")
		expect(a).toEqual(b)
	})
})
