import type { RigGraph } from "@codesoul/core"

export interface RigExtractor {
	readonly name: string
	canExtract(repoPath: string): Promise<boolean>
	extract(repoPath: string): Promise<RigGraph>
}
