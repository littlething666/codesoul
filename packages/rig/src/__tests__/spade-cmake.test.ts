import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RigExtractionError, RigGraph } from "@codesoul/core"
import {
	SpadeCMakeRigExtractor,
	type SpadeRunArgs,
	type SpadeRunner,
} from "../spade-cmake.js"

let root: string

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "codesoul-spade-"))
})

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

const writeCMake = async (): Promise<void> => {
	await writeFile(join(root, "CMakeLists.txt"), "project(x)\n", "utf8")
}

const okRun = (output: unknown): SpadeRunner =>
	async () => ({
		stdout: JSON.stringify(output),
		stderr: "",
		exitCode: 0,
	})

const exitRun = (exitCode: number, stderr: string): SpadeRunner =>
	async () => ({ stdout: "", stderr, exitCode })

describe("SpadeCMakeRigExtractor", () => {
	it("canExtract is false when CMakeLists.txt is missing", async () => {
		const e = new SpadeCMakeRigExtractor({
			run: okRun({
				version: 1,
				components: [],
				targets: [],
				tests: [],
			}),
		})
		expect(await e.canExtract(root)).toBe(false)
	})

	it("canExtract is true when CMakeLists.txt is present", async () => {
		await writeCMake()
		const e = new SpadeCMakeRigExtractor({
			run: okRun({
				version: 1,
				components: [],
				targets: [],
				tests: [],
			}),
		})
		expect(await e.canExtract(root)).toBe(true)
	})

	it("extract returns components/targets sorted by id", async () => {
		await writeCMake()
		const run: SpadeRunner = okRun({
			version: 1,
			components: [
				{
					id: "spade:b",
					name: "b",
					kind: "library",
					path: "b",
					dependsOn: [],
				},
				{
					id: "spade:a",
					name: "a",
					kind: "binary",
					path: "a",
					dependsOn: ["spade:b"],
				},
			],
			targets: [
				{
					id: "spade:a:build",
					componentId: "spade:a",
					name: "build",
					kind: "build",
				},
			],
		})
		const g = await new SpadeCMakeRigExtractor({ run }).extract(root)
		expect(g.components.map((c) => c.id)).toEqual([
			"spade:a",
			"spade:b",
		])
		expect(g.components[0]?.dependsOn).toEqual(["spade:b"])
		expect(g.targets.map((t) => t.id)).toEqual(["spade:a:build"])
		expect(g.extractor).toBe("spade-cmake-rig-extractor")
	})

	it("defaults `tests` to [] when SPADE omits the field", async () => {
		await writeCMake()
		const run: SpadeRunner = okRun({
			version: 1,
			components: [],
			targets: [],
		})
		const g = await new SpadeCMakeRigExtractor({ run }).extract(root)
		expect(g.tests).toEqual([])
	})

	it("output validates against the canonical RigGraph schema", async () => {
		await writeCMake()
		const run: SpadeRunner = okRun({
			version: 1,
			components: [
				{
					id: "spade:a",
					name: "a",
					kind: "library",
					path: ".",
					dependsOn: [],
				},
			],
			targets: [],
			tests: [],
		})
		const g = await new SpadeCMakeRigExtractor({ run }).extract(root)
		expect(() => RigGraph.parse(g)).not.toThrow()
	})

	it("fails closed (RigExtractionError) on subprocess error", async () => {
		await writeCMake()
		const run: SpadeRunner = async () => {
			throw new Error("ENOENT: spade not found")
		}
		const e = new SpadeCMakeRigExtractor({ run })
		await expect(e.extract(root)).rejects.toBeInstanceOf(
			RigExtractionError,
		)
	})

	it("fails closed on non-zero exit code", async () => {
		await writeCMake()
		const e = new SpadeCMakeRigExtractor({ run: exitRun(1, "cmake error") })
		await expect(e.extract(root)).rejects.toBeInstanceOf(
			RigExtractionError,
		)
	})

	it("fails closed on malformed JSON", async () => {
		await writeCMake()
		const run: SpadeRunner = async () => ({
			stdout: "{ not json",
			stderr: "",
			exitCode: 0,
		})
		const e = new SpadeCMakeRigExtractor({ run })
		await expect(e.extract(root)).rejects.toBeInstanceOf(
			RigExtractionError,
		)
	})

	it("fails closed when `version` is missing (unversioned JSON)", async () => {
		await writeCMake()
		const run: SpadeRunner = okRun({ components: [], targets: [], tests: [] })
		const e = new SpadeCMakeRigExtractor({ run })
		await expect(e.extract(root)).rejects.toBeInstanceOf(
			RigExtractionError,
		)
	})

	it("fails closed on a future `version: 2`", async () => {
		await writeCMake()
		const run: SpadeRunner = okRun({
			version: 2,
			components: [],
			targets: [],
			tests: [],
		})
		const e = new SpadeCMakeRigExtractor({ run })
		await expect(e.extract(root)).rejects.toBeInstanceOf(
			RigExtractionError,
		)
	})

	it("fails closed on an invalid component kind", async () => {
		await writeCMake()
		const run: SpadeRunner = okRun({
			version: 1,
			components: [
				{
					id: "spade:x",
					name: "x",
					kind: "bogus",
					path: ".",
					dependsOn: [],
				},
			],
			targets: [],
			tests: [],
		})
		const e = new SpadeCMakeRigExtractor({ run })
		await expect(e.extract(root)).rejects.toBeInstanceOf(
			RigExtractionError,
		)
	})

	it("fails closed on an invalid target kind", async () => {
		await writeCMake()
		const run: SpadeRunner = okRun({
			version: 1,
			components: [],
			targets: [
				{
					id: "spade:x:deploy",
					componentId: "spade:x",
					name: "deploy",
					kind: "deploy",
				},
			],
			tests: [],
		})
		const e = new SpadeCMakeRigExtractor({ run })
		await expect(e.extract(root)).rejects.toBeInstanceOf(
			RigExtractionError,
		)
	})

	it("passes the configured binary, args, cwd, and timeout to the runner", async () => {
		await writeCMake()
		const seen: SpadeRunArgs[] = []
		const run: SpadeRunner = async (args) => {
			seen.push(args)
			return {
				stdout: JSON.stringify({
					version: 1,
					components: [],
					targets: [],
					tests: [],
				}),
				stderr: "",
				exitCode: 0,
			}
		}
		await new SpadeCMakeRigExtractor({
			run,
			binary: "/opt/spade/bin/spade",
			args: ["--rig", "--out=-"],
			timeoutMs: 5_000,
		}).extract(root)
		expect(seen).toHaveLength(1)
		expect(seen[0]?.binary).toBe("/opt/spade/bin/spade")
		expect([...(seen[0]?.args ?? [])]).toEqual(["--rig", "--out=-"])
		expect(seen[0]?.cwd).toBe(root)
		expect(seen[0]?.timeoutMs).toBe(5_000)
	})

	it("is deterministic on identical input", async () => {
		await writeCMake()
		const run: SpadeRunner = okRun({
			version: 1,
			components: [
				{
					id: "spade:b",
					name: "b",
					kind: "library",
					path: "b",
					dependsOn: [],
				},
				{
					id: "spade:a",
					name: "a",
					kind: "binary",
					path: "a",
					dependsOn: [],
				},
			],
			targets: [],
			tests: [],
		})
		const e = new SpadeCMakeRigExtractor({ run })
		const a = await e.extract(root)
		const b = await e.extract(root)
		expect(a).toEqual(b)
	})
})
