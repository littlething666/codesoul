import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { RigGraph } from "@codesoul/core"
import { PackageJsonRigExtractor } from "../package-json.js"

let root: string

beforeEach(async () => {
	root = await mkdtemp(join(tmpdir(), "codesoul-pkgrig-"))
})

afterEach(async () => {
	await rm(root, { recursive: true, force: true })
})

describe("PackageJsonRigExtractor", () => {
	it("canExtract is false when there is no package.json", async () => {
		const r = new PackageJsonRigExtractor()
		expect(await r.canExtract(root)).toBe(false)
	})

	it("canExtract is true when a parseable package.json exists", async () => {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ name: "tiny" }),
		)
		const r = new PackageJsonRigExtractor()
		expect(await r.canExtract(root)).toBe(true)
	})

	it("emits a single 'package' component for a standalone package.json", async () => {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ name: "tiny-app", version: "0.0.0" }),
		)
		const g = await new PackageJsonRigExtractor().extract(root)
		expect(g.schemaVersion).toBe(1)
		expect(g.components).toHaveLength(1)
		const c = g.components[0]
		expect(c?.id).toBe("pkg:tiny-app")
		expect(c?.kind).toBe("package")
		expect(c?.path).toBe(".")
		expect(c?.dependsOn).toEqual([])
	})

	it("emits a 'workspace' root + member packages with workspace-internal dependsOn", async () => {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "monorepo",
				private: true,
				workspaces: ["packages/*"],
			}),
		)
		await mkdir(join(root, "packages", "a"), { recursive: true })
		await writeFile(
			join(root, "packages", "a", "package.json"),
			JSON.stringify({ name: "@org/a" }),
		)
		await mkdir(join(root, "packages", "b"), { recursive: true })
		await writeFile(
			join(root, "packages", "b", "package.json"),
			JSON.stringify({
				name: "@org/b",
				dependencies: { "@org/a": "*", chalk: "5.3.0" },
			}),
		)

		const g = await new PackageJsonRigExtractor().extract(root)
		const byId = new Map(g.components.map((c) => [c.id, c]))
		expect(byId.get("pkg:monorepo")?.kind).toBe("workspace")
		expect(byId.get("pkg:monorepo")?.dependsOn).toEqual([])
		expect(byId.get("pkg:@org/a")?.kind).toBe("package")
		expect(byId.get("pkg:@org/a")?.path).toBe("packages/a")
		// External npm dep `chalk` is excluded; only workspace-internal deps land.
		expect(byId.get("pkg:@org/b")?.dependsOn).toEqual(["pkg:@org/a"])
	})

	it("supports the npm `workspaces` object form", async () => {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "monorepo",
				private: true,
				workspaces: { packages: ["packages/*"] },
			}),
		)
		await mkdir(join(root, "packages", "a"), { recursive: true })
		await writeFile(
			join(root, "packages", "a", "package.json"),
			JSON.stringify({ name: "@org/a" }),
		)
		const g = await new PackageJsonRigExtractor().extract(root)
		const ids = g.components.map((c) => c.id).sort()
		expect(ids).toEqual(["pkg:@org/a", "pkg:monorepo"])
	})

	it("supports pnpm-workspace.yaml package globs", async () => {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({ name: "monorepo", private: true }),
		)
		await writeFile(
			join(root, "pnpm-workspace.yaml"),
			`packages:\n  - "packages/*"\n  - "apps/*"\n`,
		)
		await mkdir(join(root, "packages", "core"), { recursive: true })
		await writeFile(
			join(root, "packages", "core", "package.json"),
			JSON.stringify({ name: "@org/core" }),
		)
		await mkdir(join(root, "apps", "cli"), { recursive: true })
		await writeFile(
			join(root, "apps", "cli", "package.json"),
			JSON.stringify({
				name: "@org/cli",
				dependencies: { "@org/core": "workspace:*" },
			}),
		)
		const g = await new PackageJsonRigExtractor().extract(root)
		expect(g.components.map((c) => c.id).sort()).toEqual([
			"pkg:@org/cli",
			"pkg:@org/core",
			"pkg:monorepo",
		])
		expect(
			g.components.find((c) => c.id === "pkg:@org/cli")?.dependsOn,
		).toEqual(["pkg:@org/core"])
	})

	it("emits build/run/publish targets from package scripts", async () => {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "tiny",
				scripts: {
					build: "tsc",
					test: "vitest",
					dev: "tsx",
					publish: "npm publish",
				},
			}),
		)
		const g = await new PackageJsonRigExtractor().extract(root)
		expect(g.targets.map((t) => t.name).sort()).toEqual([
			"build",
			"dev",
			"publish",
		])
		for (const t of g.targets) {
			expect(t.componentId).toBe("pkg:tiny")
		}
		const byName = new Map(g.targets.map((t) => [t.name, t]))
		expect(byName.get("build")?.kind).toBe("build")
		expect(byName.get("dev")?.kind).toBe("run")
		expect(byName.get("publish")?.kind).toBe("publish")
	})

	it("output validates against the RigGraph schema", async () => {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "monorepo",
				private: true,
				workspaces: ["packages/*"],
				scripts: { build: "tsc" },
			}),
		)
		await mkdir(join(root, "packages", "a"), { recursive: true })
		await writeFile(
			join(root, "packages", "a", "package.json"),
			JSON.stringify({ name: "@org/a", scripts: { build: "tsup" } }),
		)
		const g = await new PackageJsonRigExtractor().extract(root)
		expect(() => RigGraph.parse(g)).not.toThrow()
	})

	it("is deterministic on identical inputs", async () => {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "monorepo",
				private: true,
				workspaces: ["packages/*"],
			}),
		)
		await mkdir(join(root, "packages", "b"), { recursive: true })
		await writeFile(
			join(root, "packages", "b", "package.json"),
			JSON.stringify({ name: "@org/b" }),
		)
		await mkdir(join(root, "packages", "a"), { recursive: true })
		await writeFile(
			join(root, "packages", "a", "package.json"),
			JSON.stringify({ name: "@org/a" }),
		)
		const r = new PackageJsonRigExtractor()
		const a = await r.extract(root)
		const b = await r.extract(root)
		expect(a).toEqual(b)
		expect(a.components.map((c) => c.id)).toEqual([
			"pkg:@org/a",
			"pkg:@org/b",
			"pkg:monorepo",
		])
	})

	it("skips workspace members whose package.json is missing or unnamed", async () => {
		await writeFile(
			join(root, "package.json"),
			JSON.stringify({
				name: "monorepo",
				private: true,
				workspaces: ["packages/*"],
			}),
		)
		await mkdir(join(root, "packages", "empty"), { recursive: true })
		await mkdir(join(root, "packages", "named"), { recursive: true })
		await writeFile(
			join(root, "packages", "named", "package.json"),
			JSON.stringify({ name: "@org/named" }),
		)
		await mkdir(join(root, "packages", "unnamed"), { recursive: true })
		await writeFile(
			join(root, "packages", "unnamed", "package.json"),
			JSON.stringify({ version: "0.0.0" }),
		)
		const g = await new PackageJsonRigExtractor().extract(root)
		expect(g.components.map((c) => c.id).sort()).toEqual([
			"pkg:@org/named",
			"pkg:monorepo",
		])
	})
})
