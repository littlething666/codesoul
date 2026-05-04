import { InvalidArgumentError, type Command } from "commander"
import { ParserMode } from "@codesoul/core"
import type { Phase0Deps } from "../wiring.js"
import { wirePhase0 } from "../wiring.js"

type IndexOptions = {
	repoId?: string
	indexRunId?: string
	dryRun: boolean
	parser?: ParserMode
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
		.action(async (repoPath: string, opts: IndexOptions) => {
			const active =
				opts.parser && opts.parser !== deps.config.parser
					? wirePhase0({ parser: opts.parser })
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
