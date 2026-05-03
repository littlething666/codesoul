import { describe, expect, it } from "vitest"
import { MockSummarizer } from "../mock.js"

describe("MockSummarizer", () => {
	it("reports modelId", () => {
		expect(new MockSummarizer().modelId).toBe("mock-summarizer")
	})

	it("summarizes a community deterministically", async () => {
		const s = new MockSummarizer()
		const input = {
			communityId: "c1",
			nodeIds: ["sym_a", "sym_b"],
			signals: { qualifiedNames: ["x.ts::a", "x.ts::b"], paths: ["x.ts"] },
		}
		const a = await s.summarizeCommunity(input)
		const b = await s.summarizeCommunity(input)
		expect(a).toEqual(b)
		expect(a.communityId).toBe("c1")
		expect(a.description).toContain("2 nodes")
		expect(a.description).toContain("x.ts::a")
	})
})
