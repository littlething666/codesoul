import { describe, expect, it } from "vitest"
import { contentId, normalizeBody, normalizeSignature, stableId } from "../ids.js"

describe("stableId", () => {
	it("is deterministic", () => {
		const input = {
			repoId: "r",
			relativePath: "src/foo.ts",
			symbolKind: "Function",
			qualifiedName: "foo",
		}
		expect(stableId(input)).toBe(stableId(input))
	})

	it("differs across symbol kinds even with same name", () => {
		const a = stableId({
			repoId: "r",
			relativePath: "src/foo.ts",
			symbolKind: "Function",
			qualifiedName: "foo",
		})
		const b = stableId({
			repoId: "r",
			relativePath: "src/foo.ts",
			symbolKind: "Class",
			qualifiedName: "foo",
		})
		expect(a).not.toBe(b)
	})

	it("is shaped sym_<40 hex>", () => {
		expect(
			stableId({
				repoId: "r",
				relativePath: "p",
				symbolKind: "Function",
				qualifiedName: "q",
			}),
		).toMatch(/^sym_[0-9a-f]{40}$/)
	})
})

describe("contentId", () => {
	it("changes when body changes", () => {
		const sig = "foo()"
		const a = contentId({
			normalizedSignature: normalizeSignature(sig),
			normalizedBody: normalizeBody("return 1"),
		})
		const b = contentId({
			normalizedSignature: normalizeSignature(sig),
			normalizedBody: normalizeBody("return 2"),
		})
		expect(a).not.toBe(b)
	})

	it("is invariant to whitespace and comments", () => {
		const a = contentId({
			normalizedSignature: normalizeSignature("foo()"),
			normalizedBody: normalizeBody("// comment\n  return  1\n"),
		})
		const b = contentId({
			normalizedSignature: normalizeSignature("foo()"),
			normalizedBody: normalizeBody("return 1"),
		})
		expect(a).toBe(b)
	})
})
