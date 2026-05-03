import { describe, expect, it } from "vitest"
import { edgeContentHash } from "../ids.js"

describe("edgeContentHash", () => {
	it("returns same hash for same edge identity", () => {
		const a = edgeContentHash({ src: "a", type: "CONTAINS", dst: "b" })
		const b = edgeContentHash({ src: "a", type: "CONTAINS", dst: "b" })
		expect(a).toBe(b)
	})

	it("changes when src changes", () => {
		const a = edgeContentHash({ src: "a1", type: "CONTAINS", dst: "b" })
		const b = edgeContentHash({ src: "a2", type: "CONTAINS", dst: "b" })
		expect(a).not.toBe(b)
	})

	it("changes when type changes", () => {
		const a = edgeContentHash({ src: "a", type: "CALLS", dst: "b" })
		const b = edgeContentHash({ src: "a", type: "IMPORTS", dst: "b" })
		expect(a).not.toBe(b)
	})

	it("changes when dst changes", () => {
		const a = edgeContentHash({ src: "a", type: "CONTAINS", dst: "b1" })
		const b = edgeContentHash({ src: "a", type: "CONTAINS", dst: "b2" })
		expect(a).not.toBe(b)
	})

	it("is shaped cnt_<40 hex>", () => {
		expect(
			edgeContentHash({ src: "a", type: "CONTAINS", dst: "b" }),
		).toMatch(/^cnt_[0-9a-f]{40}$/)
	})
})
