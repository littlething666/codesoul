import type { EmbedInput, EmbeddingResult } from "@codesoul/core"

export interface Embedder {
	readonly modelId: string
	readonly modelRevision: string
	readonly dimension: number
	embed(inputs: ReadonlyArray<EmbedInput>): Promise<EmbeddingResult[]>
}
