import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RigGraph } from "@codesoul/core"
import { ManualYamlRigExtractor } from "../manual-yaml.js"

const FILE = "codesoul.rig.yaml"

describe("ManualYamlRigExtractor", () => {
	let root: string

	beforeEach(async () => {
		root = await mkdtemp(join(tmpdir(), "codesoul-manual-yaml-"))
	})
	afterEach(async () => {
		await rm(root, { recursive: true, force: true })
	})

	it("canExtract is false when codesoul.rig.yaml is missing", async () => {
		expect(await new ManualYamlRigExtractor().canExtract(root)).toBe(
			false,
		)
	})

	it("canExtract is false when YAML is malformed", async () => {
		await writeFile(
			join(root, FILE),
			"::: not yaml :::\n  - bad\n: : :\n",
			"utf8",
		)
		expect(await new ManualYamlRigExtractor().canExtract(root)).toBe(
			false,
		)
	})

	it("canExtract is true for a minimal valid file", async () => {
		await writeFile(join(root, FILE), "schemaVersion: 1\n", "utf8")
		expect(await new ManualYamlRigExtractor().canExtract(root)).toBe(
			true,
		)
	})

	it("canExtract is true for an empty file (parses as null)", async () => {
		await writeFile(join(root, FILE), "", "utf8")
		expect(await new ManualYamlRigExtractor().canExtract(root)).toBe(
			true,
		)
	})

	it("extract returns components, targets, and tests sorted by id", async () => {
		const yaml = [
			"schemaVersion: 1",
			"components:",
			'  - id: "manual:b"',
			'    name: "b"',
			'    kind: "package"',
			'    path: "b"',
			"    dependsOn: []",
			'  - id: "manual:a"',
			'    name: "a"',
			'    kind: "app"',
			'    path: "a"',
			'    dependsOn: ["manual:b"]',
			"targets:",
			'  - id: "manual:a:build"',
			'    componentId: "manual:a"',
			'    name: "build"',
			'    kind: "build"',
			"tests:",
			'  - id: "manual:b:test"',
			'    componentId: "manual:b"',
			'    name: "vitest"',
			'    framework: "vitest"',
			"",
		].join("\n")
		await writeFile(join(root, FILE), yaml, "utf8")
		const g = await new ManualYamlRigExtractor().extract(root)
		expect(g.components.map((c) => c.id)).toEqual([
			"manual:a",
			"manual:b",
		])
		expect(g.components[0]?.dependsOn).toEqual(["manual:b"])
		expect(g.targets.map((t) => t.id)).toEqual(["manual:a:build"])
		expect(g.tests.map((t) => t.id)).toEqual(["manual:b:test"])
		expect(g.tests[0]?.framework).toBe("vitest")
	})

	it("accepts a null framework", async () => {
		const yaml = [
			"tests:",
			'  - id: "manual:x:test"',
			'    componentId: "manual:x"',
			'    name: "unknown"',
			"    framework: null",
			"",
		].join("\n")
		await writeFile(join(root, FILE), yaml, "utf8")
		const g = await new ManualYamlRigExtractor().extract(root)
		expect(g.tests).toHaveLength(1)
		expect(g.tests[0]?.framework).toBeNull()
	})

	it("rejects an invalid component kind", async () => {
		const yaml = [
			"components:",
			'  - id: "x"',
			'    name: "x"',
			'    kind: "bogus"',
			'    path: "."',
			"    dependsOn: []",
			"",
		].join("\n")
		await writeFile(join(root, FILE), yaml, "utf8")
		expect(await new ManualYamlRigExtractor().canExtract(root)).toBe(
			false,
		)
		const g = await new ManualYamlRigExtractor().extract(root)
		expect(g.components).toEqual([])
	})

	it("rejects a target with an unknown kind", async () => {
		const yaml = [
			"targets:",
			'  - id: "manual:x:nope"',
			'    componentId: "manual:x"',
			'    name: "nope"',
			'    kind: "deploy"',
			"",
		].join("\n")
		await writeFile(join(root, FILE), yaml, "utf8")
		expect(await new ManualYamlRigExtractor().canExtract(root)).toBe(
			false,
		)
	})

	it("is deterministic on identical input", async () => {
		const yaml = [
			"components:",
			'  - id: "manual:b"',
			'    name: "b"',
			'    kind: "package"',
			'    path: "b"',
			"    dependsOn: []",
			'  - id: "manual:a"',
			'    name: "a"',
			'    kind: "package"',
			'    path: "a"',
			"    dependsOn: []",
			"",
		].join("\n")
		await writeFile(join(root, FILE), yaml, "utf8")
		const a = await new ManualYamlRigExtractor().extract(root)
		const b = await new ManualYamlRigExtractor().extract(root)
		expect(a).toEqual(b)
	})

	it("output validates against RigGraph schema", async () => {
		await writeFile(
			join(root, FILE),
			"schemaVersion: 1\ncomponents: []\n",
			"utf8",
		)
		const g = await new ManualYamlRigExtractor().extract(root)
		expect(() => RigGraph.parse(g)).not.toThrow()
	})
})
