import { readFile, readdir } from "node:fs/promises"
import { join } from "node:path"
import type { RigComponent, RigGraph, RigTarget } from "@codesoul/core"
import type { RigExtractor } from "./extractor.js"

type PackageJsonShape = {
	name?: string
	version?: string
	private?: boolean
	workspaces?: ReadonlyArray<string> | { packages?: ReadonlyArray<string> }
	scripts?: Record<string, string>
	dependencies?: Record<string, string>
	devDependencies?: Record<string, string>
	peerDependencies?: Record<string, string>
}

const TARGET_SCRIPTS: ReadonlyArray<{
	script: string
	kind: RigTarget["kind"]
}> = [
	{ script: "build", kind: "build" },
	{ script: "start", kind: "run" },
	{ script: "dev", kind: "run" },
	{ script: "publish", kind: "publish" },
]

const tryReadJson = async (path: string): Promise<unknown> => {
	try {
		const text = await readFile(path, "utf8")
		return JSON.parse(text) as unknown
	} catch {
		return null
	}
}

const tryReadFile = async (path: string): Promise<string | null> => {
	try {
		return await readFile(path, "utf8")
	} catch {
		return null
	}
}

/**
 * Minimal pnpm-workspace.yaml parser.
 *
 * Recognizes the `packages:` list and pulls each `- "glob"` entry. We do
 * NOT pull in a full YAML parser here: the file format is restricted by
 * pnpm itself and the substring we care about is trivially regular.
 * ManualYamlRigExtractor (Phase 7c) takes the `yaml@2.8.3` dependency.
 */
const parsePnpmWorkspaceYaml = (content: string): string[] => {
	const lines = content.split(/\r?\n/)
	const out: string[] = []
	let inPackages = false
	for (const raw of lines) {
		const line = raw.replace(/#.*$/, "")
		if (/^\s*packages\s*:/.test(line)) {
			inPackages = true
			continue
		}
		if (inPackages) {
			const m = /^\s*-\s*['"]?([^'"\s]+)['"]?\s*$/.exec(line)
			if (m && m[1]) {
				out.push(m[1])
			} else if (/^\S/.test(line)) {
				inPackages = false
			}
		}
	}
	return out
}

const extractWorkspacePatterns = (
	pkg: PackageJsonShape,
	pnpmYaml: string | null,
): string[] => {
	if (pnpmYaml) return parsePnpmWorkspaceYaml(pnpmYaml)
	const ws = pkg.workspaces
	if (!ws) return []
	if (Array.isArray(ws)) return [...ws]
	if (typeof ws !== "object" || ws === null) return []
	return [...((ws as { packages?: ReadonlyArray<string> }).packages ?? [])]
}

/**
 * Phase 7a glob expansion.
 *
 * Supports the dominant patterns:
 *   - literal directory:  `packages/foo`
 *   - one-level wildcard: `packages/*`
 *
 * `**` is intentionally NOT expanded yet: real workspaces almost never
 * need recursive matching, and supporting it here would pull in a glob
 * library. If/when it becomes necessary, route this through `glob@13.0.6`
 * per the planning doc's pinned-deps policy.
 */
const expandPatterns = async (
	repoPath: string,
	patterns: ReadonlyArray<string>,
): Promise<string[]> => {
	const out = new Set<string>()
	for (const pattern of patterns) {
		const trimmed = pattern.trim()
		if (!trimmed) continue
		if (trimmed.includes("**")) continue
		if (trimmed.endsWith("/*")) {
			const parent = trimmed.slice(0, -2)
			const dir = join(repoPath, parent)
			try {
				const entries = await readdir(dir, { withFileTypes: true })
				for (const e of entries) {
					if (!e.isDirectory()) continue
					if (e.name.startsWith(".")) continue
					out.add(`${parent}/${e.name}`)
				}
			} catch {
				// missing directory; skip silently
			}
			continue
		}
		if (trimmed.includes("*")) continue
		out.add(trimmed)
	}
	return Array.from(out).sort()
}

const safeId = (name: string): string =>
	`pkg:${name.replace(/[^A-Za-z0-9_./@\-]/g, "_")}`

/**
 * Phase 7a RIG extractor for npm/pnpm/yarn JS+TS workspaces.
 *
 * Emits one `package` (or `workspace`, for the root of a multi-package
 * repo) RigComponent per detected `package.json`, scopes `dependsOn` to
 * workspace-internal dependencies (so external npm registry deps don't
 * pollute the architectural graph), and surfaces `build` / `start` /
 * `dev` / `publish` scripts as RigTargets.
 *
 * Not yet wired into the indexer; the dispatcher / merge phase (7e)
 * is responsible for combining this output with PyProject / Manual /
 * SPADE results and translating it into graph nodes + edges.
 */
export class PackageJsonRigExtractor implements RigExtractor {
	readonly name = "package-json-rig-extractor"

	async canExtract(repoPath: string): Promise<boolean> {
		const pkg = await tryReadJson(join(repoPath, "package.json"))
		return pkg !== null && typeof pkg === "object"
	}

	async extract(repoPath: string): Promise<RigGraph> {
		const rootPkg = (await tryReadJson(
			join(repoPath, "package.json"),
		)) as PackageJsonShape | null
		if (!rootPkg) return this.empty()

		const pnpmYaml = await tryReadFile(
			join(repoPath, "pnpm-workspace.yaml"),
		)
		const patterns = extractWorkspacePatterns(rootPkg, pnpmYaml)
		const memberPaths = await expandPatterns(repoPath, patterns)

		const memberPkgs: Array<{
			relPath: string
			pkg: PackageJsonShape
		}> = []
		for (const rel of memberPaths) {
			const memberPkg = (await tryReadJson(
				join(repoPath, rel, "package.json"),
			)) as PackageJsonShape | null
			if (memberPkg && memberPkg.name) {
				memberPkgs.push({ relPath: rel, pkg: memberPkg })
			}
		}

		const memberNames = new Set(
			memberPkgs.map((m) => m.pkg.name as string),
		)

		const dependsOnFor = (pkg: PackageJsonShape): string[] => {
			const deps = {
				...(pkg.dependencies ?? {}),
				...(pkg.devDependencies ?? {}),
				...(pkg.peerDependencies ?? {}),
			}
			return Object.keys(deps)
				.filter((d) => memberNames.has(d))
				.map((d) => safeId(d))
				.sort()
		}

		const components: RigComponent[] = []
		const rootName = rootPkg.name ?? "<root>"
		const isWorkspaceRoot = patterns.length > 0
		components.push({
			id: safeId(rootName),
			name: rootName,
			kind: isWorkspaceRoot ? "workspace" : "package",
			path: ".",
			dependsOn: isWorkspaceRoot ? [] : dependsOnFor(rootPkg),
		})
		for (const m of memberPkgs) {
			components.push({
				id: safeId(m.pkg.name as string),
				name: m.pkg.name as string,
				kind: "package",
				path: m.relPath,
				dependsOn: dependsOnFor(m.pkg),
			})
		}
		components.sort((a, b) => a.id.localeCompare(b.id))

		const targets: RigTarget[] = []
		for (const c of components) {
			const memberPkg =
				c.path === "."
					? rootPkg
					: memberPkgs.find((m) => m.relPath === c.path)?.pkg
			if (!memberPkg?.scripts) continue
			for (const { script, kind } of TARGET_SCRIPTS) {
				if (memberPkg.scripts[script]) {
					targets.push({
						id: `${c.id}:${script}`,
						componentId: c.id,
						name: script,
						kind,
					})
				}
			}
		}
		targets.sort((a, b) => a.id.localeCompare(b.id))

		return {
			extractor: this.name,
			extractorVersion: "0.0.0",
			components,
			targets,
			tests: [],
			schemaVersion: 1,
		}
	}

	private empty(): RigGraph {
		return {
			extractor: this.name,
			extractorVersion: "0.0.0",
			components: [],
			targets: [],
			tests: [],
			schemaVersion: 1,
		}
	}
}
