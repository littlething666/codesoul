import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import {
	FileSystemSourceProvider,
	MockSourceProvider,
} from "../source-provider.js"

describe("MockSourceProvider", () => {
	it("echoes path and line range", async () => {
		const p = new MockSourceProvider()
		const out = await p.readRange("src/foo.ts", [1, 10])
		expect(out).toContain("src/foo.ts")
		expect(out).toContain("1-10")
	})
})

describe("FileSystemSourceProvider", () => {
	let root: string
	const sample =
		"line 1\nline 2\nline 3\nline 4\nline 5\n"

	beforeAll(async () => {
		root = await mkdtemp(join(tmpdir(), "codesoul-fsp-"))
		await writeFile(join(root, "hello.ts"), sample, "utf8")
		await writeFile(
			join(root, "crlf.ts"),
			"a\r\nb\r\nc\r\nd\r\n",
			"utf8",
		)
	})

	afterAll(async () => {
		await rm(root, { recursive: true, force: true })
	})

	it("reads a 1-indexed inclusive line range", async () => {
		const p = new FileSystemSourceProvider(root)
		expect(await p.readRange("hello.ts", [2, 4])).toBe(
			"line 2\nline 3\nline 4",
		)
	})

	it("returns the single line at startLine when start === end", async () => {
		const p = new FileSystemSourceProvider(root)
		expect(await p.readRange("hello.ts", [3, 3])).toBe("line 3")
	})

	it("clamps startLine below 1 to 1", async () => {
		const p = new FileSystemSourceProvider(root)
		expect(await p.readRange("hello.ts", [0, 2])).toBe(
			"line 1\nline 2",
		)
	})

	it("clamps endLine to the last available line", async () => {
		const p = new FileSystemSourceProvider(root)
		expect(await p.readRange("hello.ts", [4, 999])).toBe(
			"line 4\nline 5\n",
		)
	})

	it("returns empty string when start > end", async () => {
		const p = new FileSystemSourceProvider(root)
		expect(await p.readRange("hello.ts", [4, 2])).toBe("")
	})

	it("returns empty string for missing files (no throw)", async () => {
		const p = new FileSystemSourceProvider(root)
		expect(await p.readRange("does/not/exist.ts", [1, 5])).toBe("")
	})

	it("resolves repo-relative paths against repoRoot", async () => {
		const p = new FileSystemSourceProvider(root)
		expect(await p.readRange("hello.ts", [1, 1])).toBe("line 1")
	})

	it("accepts absolute paths verbatim", async () => {
		const p = new FileSystemSourceProvider("/no/such/root")
		expect(await p.readRange(join(root, "hello.ts"), [1, 1])).toBe(
			"line 1",
		)
	})

	it("normalizes CRLF line endings", async () => {
		const p = new FileSystemSourceProvider(root)
		expect(await p.readRange("crlf.ts", [1, 3])).toBe("a\nb\nc")
	})
})
