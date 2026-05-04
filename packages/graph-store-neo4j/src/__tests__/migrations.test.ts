import { describe, expect, it } from "vitest"
import { NEO4J_MIGRATIONS } from "../migrations.js"

describe("NEO4J_MIGRATIONS", () => {
	it("declares the symbol_id unique constraint first", () => {
		expect(NEO4J_MIGRATIONS[0]).toBe(
			"CREATE CONSTRAINT symbol_id IF NOT EXISTS FOR (s:Symbol) REQUIRE s.id IS UNIQUE",
		)
	})

	it("uses IF NOT EXISTS in every statement so apply is idempotent", () => {
		for (const stmt of NEO4J_MIGRATIONS) {
			expect(stmt).toContain("IF NOT EXISTS")
		}
	})

	it("only references the :Symbol label", () => {
		for (const stmt of NEO4J_MIGRATIONS) {
			expect(stmt).toMatch(/:Symbol/)
		}
	})

	it("declares indexes for every retrieval/inspection filter dimension", () => {
		const joined = NEO4J_MIGRATIONS.join("\n")
		for (const dim of [
			"path",
			"repoId",
			"indexRunId",
			"kind",
			"qualifiedName",
		]) {
			expect(joined).toMatch(new RegExp(`ON \\(s\\.${dim}\\)`))
		}
	})
})
