import { describe, expect, it } from "vitest"
import { MockSourceProvider } from "../source-provider.js"

describe("MockSourceProvider", () => {
	it("echoes path and line range", async () => {
		const p = new MockSourceProvider()
		const out = await p.readRange("src/foo.ts", [1, 10])
		expect(out).toContain("src/foo.ts")
		expect(out).toContain("1-10")
	})
})
