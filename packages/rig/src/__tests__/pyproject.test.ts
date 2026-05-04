import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RigGraph } from "@codesoul/core"
import { PyProjectRigExtractor } from "../pyproject.js"

let root: string

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "codesoul-pyrig-"))
})

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

describe("PyProjectRigExtractor", () => {
	it("canExtract is false when pyproject.toml is absent", async () => {
		expect(await new PyProjectRigExtractor().canExtract(root)).toBe(false)
	})

	it("canExtract is false when pyproject.toml is malformed", async () => {
		await writeFile(
			join(root, "pyproject.toml"),
			"this is = not = toml [",
		)
		expect(await new PyProjectRigExtractor().canExtract(root)).toBe(false)
	})

	it("canExtract is true for a minimal valid pyproject.toml", async () => {
		await writeFile(
			join(root, "pyproject.toml"),
			`[project]\nname = "tiny-py"\n`,
		)
		expect(await new PyProjectRigExtractor().canExtract(root)).toBe(true)
	})

	it("emits a single 'package' component from [project]", async () => {
		await writeFile(
			join(root, "pyproject.toml"),
			`[project]\nname = "tiny-py"\nversion = "0.0.0"\n`,
		)
		const g = await new PyProjectRigExtractor().extract(root)
		expect(g.components).toHaveLength(1)
		const c = g.components[0]
		expect(c?.id).toBe("py:tiny-py")
		expect(c?.name).toBe("tiny-py")
		expect(c?.kind).toBe("package")
		expect(c?.path).toBe(".")
		expect(c?.dependsOn).toEqual([])
	})

	it("strips PEP-440 version specifiers from dependsOn entries", async () => {
		await writeFile(
			join(root, "pyproject.toml"),
			`[project]\nname = "tiny-py"\ndependencies = [\n  "fastapi==0.136.1",\n  "pydantic>=2.13.3,<3",\n  "torch~=2.11.0",\n  "requests[security]>=2.31",\n]\n`,
		)
		const g = await new PyProjectRigExtractor().extract(root)
		expect(g.components[0]?.dependsOn).toEqual([
			"py:fastapi",
			"py:pydantic",
			"py:requests",
			"py:torch",
		])
	})

	it("emits 'run' targets from [project.scripts] sorted by name", async () => {
		await writeFile(
			join(root, "pyproject.toml"),
			`[project]\nname = "tiny-py"\n\n[project.scripts]\nworker = "tiny.worker:run"\nstart = "tiny.cli:main"\n`,
		)
		const g = await new PyProjectRigExtractor().extract(root)
		expect(g.targets.map((t) => t.name)).toEqual(["start", "worker"])
		for (const t of g.targets) {
			expect(t.kind).toBe("run")
			expect(t.componentId).toBe("py:tiny-py")
		}
	})

	it("returns an empty graph when [project].name is missing", async () => {
		await writeFile(
			join(root, "pyproject.toml"),
			`[build-system]\nrequires = ["setuptools"]\n`,
		)
		const g = await new PyProjectRigExtractor().extract(root)
		expect(g.components).toEqual([])
		expect(g.targets).toEqual([])
		expect(g.tests).toEqual([])
	})

	it("output validates against the RigGraph schema", async () => {
		await writeFile(
			join(root, "pyproject.toml"),
			`[project]\nname = "tiny-py"\nversion = "0.0.0"\ndependencies = ["fastapi==0.136.1"]\n\n[project.scripts]\nstart = "tiny.cli:main"\n`,
		)
		const g = await new PyProjectRigExtractor().extract(root)
		expect(() => RigGraph.parse(g)).not.toThrow()
	})

	it("is deterministic on the same input", async () => {
		await writeFile(
			join(root, "pyproject.toml"),
			`[project]\nname = "tiny-py"\ndependencies = ["b==1", "a==1"]\n`,
		)
		const r = new PyProjectRigExtractor()
		const a = await r.extract(root)
		const b = await r.extract(root)
		expect(a).toEqual(b)
		expect(a.components[0]?.dependsOn).toEqual(["py:a", "py:b"])
	})
})
