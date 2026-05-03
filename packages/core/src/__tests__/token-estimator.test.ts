import { describe, expect, it } from "vitest"
import { ByteTokenEstimator } from "../token-estimator.js"

describe("ByteTokenEstimator", () => {
	it("returns 0 for empty string", () => {
		expect(new ByteTokenEstimator().estimate("")).toBe(0)
	})

	it("is monotonic in input length", () => {
		const e = new ByteTokenEstimator()
		expect(e.estimate("a")).toBeLessThanOrEqual(e.estimate("aa"))
		expect(e.estimate("aa")).toBeLessThanOrEqual(e.estimate("aaa"))
	})

	it("counts utf-8 bytes, not characters", () => {
		const e = new ByteTokenEstimator()
		// '€' is 3 bytes in utf-8, ceil(3/3.5) = 1
		expect(e.estimate("\u20AC")).toBe(1)
		// 1024-byte string -> ceil(1024/3.5) = 293
		expect(e.estimate("a".repeat(1024))).toBe(Math.ceil(1024 / 3.5))
	})
})
