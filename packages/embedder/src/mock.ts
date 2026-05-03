import { createHash } from "node:crypto"
import { EMBEDDING_DIM } from "@codesoul/core"
import type { EmbedInput, EmbeddingResult } from "@codesoul/core"
import type { Embedder } from "./embedder.js"

const valueAt = (text: string, i: number): number => {
	const h = createHash("sha256")
		.update(text)
		.update("\u0000")
		.update(String(i))
		.digest()
	const n = h.readUInt32BE(0)
	return (n / 0xffffffff) * 2 - 1
}

export class MockEmbedder implements Embedder {
	readonly modelId = "mock-embedder"
	readonly modelRevision = "0"
	readonly dimension = EMBEDDING_DIM

	async embed(
		inputs: ReadonlyArray<EmbedInput>,
	): Promise<EmbeddingResult[]> {
		return inputs.map((input) => {
			const vec = new Array<number>(EMBEDDING_DIM)
			for (let i = 0; i < EMBEDDING_DIM; i++) {
				vec[i] = valueAt(input.text, i)
			}
			return {
				nodeId: input.nodeId,
				vector: vec,
				embeddingModel: this.modelId,
				embeddingRevision: this.modelRevision,
				embeddingDim: EMBEDDING_DIM,
			}
		})
	}
}
