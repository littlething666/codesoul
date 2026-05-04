import { describe, expect, it } from "vitest"
import type { RigGraph as RigGraphT } from "@codesoul/core"
import { RigGraph } from "@codesoul/core"
import { RigDispatcher, mergeRigGraphs } from "../dispatcher.js"
import type { RigExtractor } from "../extractor.js"

const emptyGraph = (extractor: string): RigGraphT => ({
	extractor,
	extractorVersion: "0",
	components: [],
	targets: [],
	tests: [],
	schemaVersion: 1,
})

const stub = (
	name: string,
	canExtract: boolean,
	graph: RigGraphT,
): RigExtractor => ({
	name,
	canExtract: async () => canExtract,
	extract: async () => graph,
})

describe("RigDispatcher", () => {
	it("canExtract is false when no underlying extractor matches", async () => {
		const d = new RigDispatcher([stub("a", false, emptyGraph("a"))])
		expect(await d.canExtract("/tmp")).toBe(false)
	})

	it("canExtract is true when at least one extractor matches", async () => {
		const d = new RigDispatcher([
			stub("a", false, emptyGraph("a")),
			stub("b", true, emptyGraph("b")),
		])
		expect(await d.canExtract("/tmp")).toBe(true)
	})

	it("canExtract is false on an empty extractor list", async () => {
		expect(await new RigDispatcher([]).canExtract("/tmp")).toBe(false)
	})

	it("only calls extract on extractors whose canExtract is true", async () => {
		let aCalls = 0
		let bCalls = 0
		const a: RigExtractor = {
			name: "a",
			canExtract: async () => false,
			extract: async () => {
				aCalls++
				return emptyGraph("a")
			},
		}
		const b: RigExtractor = {
			name: "b",
			canExtract: async () => true,
			extract: async () => {
				bCalls++
				return emptyGraph("b")
			},
		}
		await new RigDispatcher([a, b]).extract("/tmp")
		expect(aCalls).toBe(0)
		expect(bCalls).toBe(1)
	})

	it("returns a schema-valid empty graph when nothing matches", async () => {
		const g = await new RigDispatcher([]).extract("/tmp")
		expect(() => RigGraph.parse(g)).not.toThrow()
		expect(g.components).toEqual([])
		expect(g.targets).toEqual([])
		expect(g.tests).toEqual([])
		expect(g.extractor).toBe("rig-dispatcher")
	})

	it("merges components by id and unions dependsOn", async () => {
		const a = stub("a", true, {
			...emptyGraph("a"),
			components: [
				{
					id: "pkg:foo",
					name: "foo",
					kind: "package",
					path: ".",
					dependsOn: ["pkg:bar"],
				},
			],
		})
		const b = stub("b", true, {
			...emptyGraph("b"),
			components: [
				{
					id: "pkg:foo",
					name: "foo",
					kind: "package",
					path: ".",
					dependsOn: ["pkg:baz"],
				},
			],
		})
		const g = await new RigDispatcher([a, b]).extract("/tmp")
		expect(g.components).toHaveLength(1)
		expect(g.components[0]?.dependsOn).toEqual(["pkg:bar", "pkg:baz"])
	})

	it("first writer wins on identity fields when ids collide", async () => {
		const a = stub("a", true, {
			...emptyGraph("a"),
			components: [
				{
					id: "pkg:foo",
					name: "foo-from-a",
					kind: "package",
					path: ".",
					dependsOn: [],
				},
			],
		})
		const b = stub("b", true, {
			...emptyGraph("b"),
			components: [
				{
					id: "pkg:foo",
					name: "foo-from-b",
					kind: "workspace",
					path: "elsewhere",
					dependsOn: [],
				},
			],
		})
		const g = await new RigDispatcher([a, b]).extract("/tmp")
		expect(g.components[0]?.name).toBe("foo-from-a")
		expect(g.components[0]?.kind).toBe("package")
		expect(g.components[0]?.path).toBe(".")
	})

	it("dedupes targets and tests by id (first writer wins)", async () => {
		const a = stub("a", true, {
			...emptyGraph("a"),
			targets: [
				{
					id: "pkg:foo:build",
					componentId: "pkg:foo",
					name: "build",
					kind: "build",
				},
			],
			tests: [
				{
					id: "pkg:foo:test",
					componentId: "pkg:foo",
					name: "vitest",
					framework: "vitest",
				},
			],
		})
		const b = stub("b", true, {
			...emptyGraph("b"),
			targets: [
				{
					id: "pkg:foo:build",
					componentId: "pkg:foo",
					name: "build",
					kind: "run",
				},
			],
			tests: [
				{
					id: "pkg:foo:test",
					componentId: "pkg:foo",
					name: "jest",
					framework: "jest",
				},
			],
		})
		const g = await new RigDispatcher([a, b]).extract("/tmp")
		expect(g.targets).toHaveLength(1)
		expect(g.targets[0]?.kind).toBe("build")
		expect(g.tests).toHaveLength(1)
		expect(g.tests[0]?.framework).toBe("vitest")
	})

	it("sorts components, targets, and tests by id deterministically", async () => {
		const a = stub("a", true, {
			...emptyGraph("a"),
			components: [
				{
					id: "pkg:b",
					name: "b",
					kind: "package",
					path: "b",
					dependsOn: [],
				},
				{
					id: "pkg:a",
					name: "a",
					kind: "package",
					path: "a",
					dependsOn: [],
				},
			],
			targets: [
				{
					id: "pkg:b:build",
					componentId: "pkg:b",
					name: "build",
					kind: "build",
				},
				{
					id: "pkg:a:build",
					componentId: "pkg:a",
					name: "build",
					kind: "build",
				},
			],
		})
		const g = await new RigDispatcher([a]).extract("/tmp")
		expect(g.components.map((c) => c.id)).toEqual(["pkg:a", "pkg:b"])
		expect(g.targets.map((t) => t.id)).toEqual([
			"pkg:a:build",
			"pkg:b:build",
		])
	})

	it("itself satisfies RigExtractor and is composable", async () => {
		const inner = new RigDispatcher([
			stub("x", true, {
				...emptyGraph("x"),
				components: [
					{
						id: "pkg:x",
						name: "x",
						kind: "package",
						path: ".",
						dependsOn: [],
					},
				],
			}),
		])
		const outer = new RigDispatcher([inner])
		const g = await outer.extract("/tmp")
		expect(g.extractor).toBe("rig-dispatcher")
		expect(g.components.map((c) => c.id)).toEqual(["pkg:x"])
	})

	it("output validates against RigGraph schema", async () => {
		const a = stub("a", true, {
			...emptyGraph("a"),
			components: [
				{
					id: "pkg:a",
					name: "a",
					kind: "package",
					path: ".",
					dependsOn: [],
				},
			],
		})
		const g = await new RigDispatcher([a]).extract("/tmp")
		expect(() => RigGraph.parse(g)).not.toThrow()
	})
})

describe("mergeRigGraphs", () => {
	it("is exposed for callers that already collected RigGraphs", () => {
		const a = emptyGraph("a")
		const b = emptyGraph("b")
		const merged = mergeRigGraphs([
			{
				...a,
				components: [
					{
						id: "pkg:a",
						name: "a",
						kind: "package",
						path: ".",
						dependsOn: [],
					},
				],
			},
			{
				...b,
				components: [
					{
						id: "pkg:b",
						name: "b",
						kind: "package",
						path: "b",
						dependsOn: [],
					},
				],
			},
		])
		expect(merged.components.map((c) => c.id)).toEqual([
			"pkg:a",
			"pkg:b",
		])
		expect(merged.extractor).toBe("rig-dispatcher")
	})

	it("sorts dependsOn deterministically when only one writer is present", () => {
		const merged = mergeRigGraphs([
			{
				...emptyGraph("a"),
				components: [
					{
						id: "pkg:a",
						name: "a",
						kind: "package",
						path: ".",
						dependsOn: ["pkg:z", "pkg:m", "pkg:b"],
					},
				],
			},
		])
		expect(merged.components[0]?.dependsOn).toEqual([
			"pkg:b",
			"pkg:m",
			"pkg:z",
		])
	})
})
