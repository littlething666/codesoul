import { describe, expect, it } from "vitest"
import fc from "fast-check"
import {
	contentId,
	edgeContentHash,
	hashParts,
	normalizeBody,
	normalizeSignature,
	stableId,
} from "../ids.js"

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

	it("is deterministic for arbitrary inputs (property-based)", () => {
		fc.assert(
			fc.property(
				fc.string(),
				fc.string(),
				fc.string(),
				fc.string(),
				(repoId, relativePath, symbolKind, qualifiedName) => {
					const input = {
						repoId,
						relativePath,
						symbolKind,
						qualifiedName,
					}
					return stableId(input) === stableId(input)
				},
			),
		)
	})

	it("does not collide for distinct small-domain tuples", () => {
		const seen = new Map<string, string>()
		const repos = ["r1", "r2"]
		const paths = ["a.ts", "b.ts"]
		const kinds = ["Function", "Class"]
		const names = ["x", "y"]
		for (const repoId of repos) {
			for (const relativePath of paths) {
				for (const symbolKind of kinds) {
					for (const qualifiedName of names) {
						const id = stableId({
							repoId,
							relativePath,
							symbolKind,
							qualifiedName,
						})
						const tuple = `${repoId}|${relativePath}|${symbolKind}|${qualifiedName}`
						const existing = seen.get(id)
						if (existing) {
							expect(existing).toBe(tuple)
						} else {
							seen.set(id, tuple)
						}
					}
				}
			}
		}
		expect(seen.size).toBe(
			repos.length * paths.length * kinds.length * names.length,
		)
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

	it("is shaped cnt_<40 hex>", () => {
		expect(
			contentId({
				normalizedSignature: "x",
				normalizedBody: "y",
			}),
		).toMatch(/^cnt_[0-9a-f]{40}$/)
	})

	it("is deterministic for arbitrary inputs (property-based)", () => {
		fc.assert(
			fc.property(fc.string(), fc.string(), (sig, body) => {
				const input = {
					normalizedSignature: sig,
					normalizedBody: body,
				}
				return contentId(input) === contentId(input)
			}),
		)
	})
})

describe("normalizeSignature", () => {
	it("is idempotent", () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const once = normalizeSignature(raw)
				const twice = normalizeSignature(once)
				return twice === once
			}),
		)
	})
})

describe("normalizeBody", () => {
	it("is idempotent", () => {
		fc.assert(
			fc.property(fc.string(), (raw) => {
				const once = normalizeBody(raw)
				const twice = normalizeBody(once)
				return twice === once
			}),
		)
	})

	// TODO Phase 1: make normalization language-aware.
	// In TypeScript, #x is a private field, not a comment.
	it("currently treats # as a comment marker even in TS private fields", () => {
		expect(normalizeBody("class A { #x = 1 }")).toBe("class A {")
	})
})

describe("hashParts", () => {
	it("returns a 40-char hex string", () => {
		expect(hashParts(["a", "b"])).toMatch(/^[0-9a-f]{40}$/)
	})

	it("is order-sensitive", () => {
		expect(hashParts(["a", "b"])).not.toBe(hashParts(["b", "a"]))
	})
})

describe("edgeContentHash (smoke)", () => {
	it("agrees with hashParts on the (src,type,dst) tuple", () => {
		const direct = `cnt_${hashParts(["a", "CONTAINS", "b"])}`
		expect(edgeContentHash({ src: "a", type: "CONTAINS", dst: "b" })).toBe(
			direct,
		)
	})
})
