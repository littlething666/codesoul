import { InvalidArgumentError, type Command } from "commander"
import { ParserMode, RigExtractorKind } from "@codesoul/core"
import type { Phase0Deps } from "../wiring.js"
import { wirePhase0 } from "../wiring.js"

type IndexOptions = {
	repoId?: string
	indexRunId?: string
	dryRun: boolean
	parser?: ParserMode
	rigExtractors?: RigExtractorKind[]
}

const parseParserMode = (value: string): ParserMode => {
	const result = ParserMode.safeParse(value)
	if (!result.success) {
		throw new InvalidArgumentError(
			"must be one of: regex, tree-sitter",
		)
	}
	return result.data
}

const parseRigExtractorList = (value: string): RigExtractorKind[] => {
	const items = value
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
	const out: RigExtractorKind[] = []
	for (const item of items) {
		const result = RigExtractorKind.safeParse(item)
		if (!result.success) {
			throw new InvalidArgumentError(
				`unknown rig extractor: '${item}' (must be one of: package-json, pyproject, manual, spade)`,
			)
		}
		out.push(result.data)
	}
	return out
}

const rigListsEqual = (
	a: ReadonlyArray<RigExtractorKind>,
	b: ReadonlyArray<RigExtractorKind>,
): boolean => {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
	return true
}

export const registerIndex = (program: Command, deps: Phase0Deps): void => {
	program
		.command("index")
		.description("Index a repository (Phase 0: mocks only)")
		.argument("<repoPath>", "path to the repository")
		.option("--repo-id <id>", "explicit repo id")
		.option("--index-run-id <id>", "explicit index run id")
		.option("--dry-run", "parse and validate without persisting", false)
		.option(
			"--parser <mode>",
			"parser implementation (regex | tree-sitter)",
			parseParserMode,
		)
		.option(
			"--rig-extractors <list>",
			"comma-separated RIG extractors (package-json,pyproject,manual,spade)",
			parseRigExtractorList,
		)
		.action(async (repoPath: string, opts: IndexOptions) => {
			const parserChanged =
				opts.parser !== undefined && opts.parser !== deps.config.parser
			const rigChanged =
				opts.rigExtractors !== undefined &&
				!rigListsEqual(opts.rigExtractors, deps.config.rigExtractors)
			const active =
				parserChanged || rigChanged
					? wirePhase0({
							parser: opts.parser ?? deps.config.parser,
							rigExtractors:
								opts.rigExtractors ?? deps.config.rigExtractors,
						})
					: deps

			const result = await active.indexer.indexRepository({
				repoPath,
				repoId: opts.repoId ?? "repo_fixture",
				indexRunId: opts.indexRunId ?? "run_phase0",
				dryRun: opts.dryRun,
			})

			console.log(
				JSON.stringify(
					{
						status: result.manifest.status,
						batchId: result.manifest.batchId,
						parser: active.config.parser,
						rigExtractors: active.config.rigExtractors,
						nodes: result.nodeCount,
						edges: result.edgeCount,
						vectors: result.vectorCount,
					},
					null,
					2,
				),
			)
		})
}
