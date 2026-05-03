import type { Command } from "commander"
import type { Phase0Deps } from "../wiring.js"

type IndexOptions = {
	repoId?: string
	indexRunId?: string
	dryRun: boolean
}

export const registerIndex = (program: Command, deps: Phase0Deps): void => {
	program
		.command("index")
		.description("Index a repository (Phase 0: mocks only)")
		.argument("<repoPath>", "path to the repository")
		.option("--repo-id <id>", "explicit repo id")
		.option("--index-run-id <id>", "explicit index run id")
		.option("--dry-run", "parse and validate without persisting", false)
		.action(async (repoPath: string, opts: IndexOptions) => {
			const result = await deps.indexer.indexRepository({
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
