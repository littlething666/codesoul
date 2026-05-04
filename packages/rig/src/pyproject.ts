import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { parse as parseToml } from "smol-toml"
import type { RigComponent, RigGraph, RigTarget } from "@codesoul/core"
import type { RigExtractor } from "./extractor.js"

type PyProjectShape = {
	project?: {
		name?: string
		version?: string
		dependencies?: ReadonlyArray<string>
		scripts?: Record<string, string>
		"optional-dependencies"?: Record<string, ReadonlyArray<string>>
	}
}

const tryReadFile = async (path: string): Promise<string | null> => {
	try {
		return await readFile(path, "utf8")
	} catch {
		return null
	}
}

const tryParseToml = (content: string): PyProjectShape | null => {
	try {
		return parseToml(content) as unknown as PyProjectShape
	} catch {
		return null
	}
}

/**
 * Strip a PEP-440 / requirements-style version specifier off a dependency
 * string and return just the distribution name.
 *
 *   "fastapi==0.136.1"     -> "fastapi"
 *   "pydantic>=2.13.3,<3"  -> "pydantic"
 *   "torch~=2.11.0"        -> "torch"
 *   "requests[security]"   -> "requests"
 *
 * We accept the standard distribution name character set; anything else
 * marks the end of the name. Returns "" if no name is found so the caller
 * can drop empty/garbage entries.
 */
const stripVersionSpec = (specifier: string): string => {
	const m = /^[A-Za-z0-9_.\-]+/.exec(specifier.trim())
	return m ? m[0] : ""
}

const safeId = (name: string): string =>
	`py:${name.replace(/[^A-Za-z0-9_./@\-]/g, "_")}`

/**
 * Phase 7b RIG extractor for Python projects with a PEP-621 `[project]`
 * section in `pyproject.toml`.
 *
 * Emits one `package` RigComponent for the project, with `dependsOn`
 * sourced from `project.dependencies` (version specifiers stripped), and
 * `run` RigTargets per `project.scripts` entry. `optional-dependencies`
 * groups (for example `vllm`, `graph-algos` from the planning doc) are
 * intentionally not flattened into `dependsOn` here; surfacing them is
 * the dispatcher's job.
 */
export class PyProjectRigExtractor implements RigExtractor {
	readonly name = "pyproject-rig-extractor"

	async canExtract(repoPath: string): Promise<boolean> {
		const text = await tryReadFile(join(repoPath, "pyproject.toml"))
		if (!text) return false
		return tryParseToml(text) !== null
	}

	async extract(repoPath: string): Promise<RigGraph> {
		const text = await tryReadFile(join(repoPath, "pyproject.toml"))
		if (!text) return this.empty()
		const data = tryParseToml(text)
		if (!data?.project?.name) return this.empty()

		const project = data.project
		const projectName = project.name as string
		const id = safeId(projectName)

		const deps = (project.dependencies ?? [])
			.map(stripVersionSpec)
			.filter((s) => s.length > 0)
			.map(safeId)
			.sort()

		const components: RigComponent[] = [
			{
				id,
				name: projectName,
				kind: "package",
				path: ".",
				dependsOn: deps,
			},
		]

		const targets: RigTarget[] = []
		if (project.scripts) {
			const scriptNames = Object.keys(project.scripts).sort()
			for (const scriptName of scriptNames) {
				targets.push({
					id: `${id}:${scriptName}`,
					componentId: id,
					name: scriptName,
					kind: "run",
				})
			}
		}

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
