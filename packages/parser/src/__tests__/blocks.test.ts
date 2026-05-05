import { describe, expect, it } from "vitest"
import {
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
	stableId,
} from "@codesoul/core"
import type { BlockSyntaxNode } from "../blocks.js"
import {
	DEFAULT_BLOCK_LINE_THRESHOLD,
	DEFAULT_BLOCK_TOKEN_THRESHOLD,
	extractBlocks,
	shouldExtractBlocks,
} from "../blocks.js"

// ---- Helpers --------------------------------------------------------------

// Synthetic SyntaxNode for unit tests. Block extraction only reads the
// fields declared on BlockSyntaxNode, so we don't need a real tree-sitter
// parse to exercise extractBlocks.
const makeNode = (
	type: string,
	source: string,
	startIndex: number,
	endIndex: number,
	startRow: number,
	endRow: number,
	children: BlockSyntaxNode[] = [],
): BlockSyntaxNode => ({
	type,
	startIndex,
	endIndex,
	startPosition: { row: startRow, column: 0 },
	endPosition: { row: endRow, column: 0 },
	namedChildCount: children.length,
	namedChild: (i) => children[i] ?? null,
})

const PARENT_QNAME = "src/x.ts::big"
const PARENT_ID = stableId({
	repoId: "r",
	relativePath: "src/x.ts",
	symbolKind: "Function",
	qualifiedName: PARENT_QNAME,
})

const commonArgs = {
	repoId: "r",
	indexRunId: "run_t",
	batchId: "batch_t",
	path: "src/x.ts",
	language: "typescript" as const,
	parentNodeId: PARENT_ID,
	parentQualifiedName: PARENT_QNAME,
}

// ---- shouldExtractBlocks --------------------------------------------------

describe("shouldExtractBlocks", () => {
	it("is false for tiny bodies under both thresholds", () => {
		expect(shouldExtractBlocks("return 1", 3)).toBe(false)
	})

	it("is true when lineSpan strictly exceeds the line threshold", () => {
		expect(shouldExtractBlocks("return 1", DEFAULT_BLOCK_LINE_THRESHOLD + 1)).toBe(
			true,
		)
	})

	it("is false when lineSpan equals the line threshold (strict >)", () => {
		expect(shouldExtractBlocks("return 1", DEFAULT_BLOCK_LINE_THRESHOLD)).toBe(
			false,
		)
	})

	it("is true when estimated tokens strictly exceed the token threshold", () => {
		// ByteTokenEstimator: ~3.5 bytes/token. 4096 ASCII bytes -> ~1170 tokens.
		const big = "a".repeat(4096)
		expect(shouldExtractBlocks(big, 1)).toBe(true)
	})

	it("respects custom thresholds", () => {
		expect(
			shouldExtractBlocks("a".repeat(40), 1, { tokenThreshold: 10 }),
		).toBe(true)
		expect(
			shouldExtractBlocks("return 1", 5, { lineThreshold: 4 }),
		).toBe(true)
	})
})

// ---- extractBlocks --------------------------------------------------------

describe("extractBlocks", () => {
	it("is a no-op when the trigger is not satisfied", () => {
		const body = makeNode("statement_block", "", 0, 1, 0, 0, [
			makeNode("if_statement", "if (x) { y }", 0, 12, 1, 1),
		])
		const r = extractBlocks({
			...commonArgs,
			bodyNode: body,
			source: "if (x) { y }",
			parentBodyText: "return 1",
			parentLineSpan: 3,
		})
		expect(r.nodes).toEqual([])
		expect(r.edges).toEqual([])
	})

	it("emits Block nodes in syntactic order with stable ordinal-based ids", () => {
		const src = "AAA BBB CCC"
		const body = makeNode("statement_block", src, 0, src.length, 0, 2, [
			makeNode("if_statement", "AAA", 0, 3, 0, 0),
			makeNode("for_statement", "BBB", 4, 7, 1, 1),
			makeNode("while_statement", "CCC", 8, 11, 2, 2),
		])
		const r = extractBlocks({
			...commonArgs,
			bodyNode: body,
			source: src,
			parentBodyText: src,
			parentLineSpan: 1,
			options: { tokenThreshold: 0, lineThreshold: 0 },
		})
		expect(r.nodes).toHaveLength(3)
		const sigs = r.nodes.map((n) => n.signature)
		expect(sigs).toEqual(["if", "for", "while"])
		const qns = r.nodes.map((n) => n.qualifiedName)
		expect(qns).toEqual([
			`${PARENT_QNAME}#block:0`,
			`${PARENT_QNAME}#block:1`,
			`${PARENT_QNAME}#block:2`,
		])
		// Each id matches stableId(...)#ordinal — line numbers excluded.
		for (let i = 0; i < r.nodes.length; i++) {
			expect(r.nodes[i]?.id).toBe(
				stableId({
					repoId: "r",
					relativePath: "src/x.ts",
					symbolKind: "Block",
					qualifiedName: `${PARENT_QNAME}#block:${i}`,
				}),
			)
		}
	})

	it("emits a CONTAINS edge from parent to each Block", () => {
		const src = "AAA"
		const body = makeNode("statement_block", src, 0, 3, 0, 0, [
			makeNode("if_statement", "AAA", 0, 3, 0, 0),
		])
		const r = extractBlocks({
			...commonArgs,
			bodyNode: body,
			source: src,
			parentBodyText: src,
			parentLineSpan: 1,
			options: { tokenThreshold: 0, lineThreshold: 0 },
		})
		expect(r.edges).toHaveLength(1)
		const edge = r.edges[0]
		expect(edge?.src).toBe(PARENT_ID)
		expect(edge?.dst).toBe(r.nodes[0]?.id)
		expect(edge?.type).toBe("CONTAINS")
	})

	it("skips body children that are not block-shaped", () => {
		// `expression_statement` is a regular statement, NOT a block.
		const src = "x; if (a) { b }"
		const body = makeNode("statement_block", src, 0, src.length, 0, 1, [
			makeNode("expression_statement", "x;", 0, 2, 0, 0),
			makeNode("if_statement", "if (a) { b }", 3, 15, 1, 1),
		])
		const r = extractBlocks({
			...commonArgs,
			bodyNode: body,
			source: src,
			parentBodyText: src,
			parentLineSpan: 1,
			options: { tokenThreshold: 0, lineThreshold: 0 },
		})
		expect(r.nodes).toHaveLength(1)
		expect(r.nodes[0]?.signature).toBe("if")
	})

	it("recognises Python block kinds", () => {
		const src = "if a:\n  b\nfor x in y:\n  z\nmatch v:\n  case 1: 2"
		const body = makeNode("block", src, 0, src.length, 0, 5, [
			makeNode("if_statement", "if a:\n  b", 0, 9, 0, 1),
			makeNode("for_statement", "for x in y:\n  z", 10, 25, 2, 3),
			makeNode("match_statement", "match v:\n  case 1: 2", 26, 47, 4, 5),
		])
		const r = extractBlocks({
			...commonArgs,
			language: "python",
			path: "src/x.py",
			bodyNode: body,
			source: src,
			parentBodyText: src,
			parentLineSpan: 1,
			options: { tokenThreshold: 0, lineThreshold: 0 },
		})
		expect(r.nodes.map((n) => n.signature)).toEqual(["if", "for", "match"])
	})

	it("includes line numbers in evidence but NOT in id", () => {
		const src = "AAA"
		const makeWithLines = (start: number, end: number) =>
			extractBlocks({
				...commonArgs,
				bodyNode: makeNode("statement_block", src, 0, 3, 0, 0, [
					makeNode("if_statement", "AAA", 0, 3, start, end),
				]),
				source: src,
				parentBodyText: src,
				parentLineSpan: 1,
				options: { tokenThreshold: 0, lineThreshold: 0 },
			})
		const a = makeWithLines(10, 12)
		const b = makeWithLines(99, 110)
		expect(a.nodes[0]?.id).toBe(b.nodes[0]?.id)
		expect(a.nodes[0]?.evidence.startLine).toBe(11)
		expect(b.nodes[0]?.evidence.startLine).toBe(100)
	})

	it("validates every emitted node and edge against the schemas", () => {
		const src = "AAAA BBBB"
		const body = makeNode("statement_block", src, 0, src.length, 0, 1, [
			makeNode("if_statement", "AAAA", 0, 4, 0, 0),
			makeNode("try_statement", "BBBB", 5, 9, 1, 1),
		])
		const r = extractBlocks({
			...commonArgs,
			bodyNode: body,
			source: src,
			parentBodyText: src,
			parentLineSpan: 1,
			options: { tokenThreshold: 0, lineThreshold: 0 },
		})
		for (const n of r.nodes) GraphNodeSchema.parse(n)
		for (const e of r.edges) GraphEdgeSchema.parse(e)
	})

	it("is deterministic on identical inputs", () => {
		const run = () => {
			const src = "AAA BBB"
			return extractBlocks({
				...commonArgs,
				bodyNode: makeNode("statement_block", src, 0, src.length, 0, 1, [
					makeNode("if_statement", "AAA", 0, 3, 0, 0),
					makeNode("for_statement", "BBB", 4, 7, 1, 1),
				]),
				source: src,
				parentBodyText: src,
				parentLineSpan: 1,
				options: { tokenThreshold: 0, lineThreshold: 0 },
			})
		}
		const a = run()
		const b = run()
		expect(a).toEqual(b)
	})

	it("defaults preserve real-world large bodies (~512 tokens)", () => {
		// 4096 ASCII bytes / 3.5 ~= 1170 tokens, well above the default 512.
		const large = "a".repeat(4096)
		const body = makeNode("statement_block", large, 0, large.length, 0, 5, [
			makeNode("if_statement", large, 0, large.length, 0, 5),
		])
		const r = extractBlocks({
			...commonArgs,
			bodyNode: body,
			source: large,
			parentBodyText: large,
			parentLineSpan: 5,
		})
		expect(r.nodes).toHaveLength(1)
	})

	it("respects DEFAULT_BLOCK_TOKEN_THRESHOLD constant", () => {
		expect(DEFAULT_BLOCK_TOKEN_THRESHOLD).toBe(512)
		expect(DEFAULT_BLOCK_LINE_THRESHOLD).toBe(60)
	})
})
