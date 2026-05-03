import type { RigGraph } from "@codesoul/core"
import type { RigExtractor } from "./extractor.js"

export class MockRigExtractor implements RigExtractor {
	readonly name = "mock-rig-extractor"

	async canExtract(_repoPath: string): Promise<boolean> {
		return true
	}

	async extract(_repoPath: string): Promise<RigGraph> {
		return {
			extractor: this.name,
			extractorVersion: "0.0.0",
			components: [
				{
					id: "comp_root",
					name: "root",
					kind: "package",
					path: ".",
					dependsOn: [],
				},
			],
			targets: [],
			tests: [],
			schemaVersion: 1,
		}
	}
}
