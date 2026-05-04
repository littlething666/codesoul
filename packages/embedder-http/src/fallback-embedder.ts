import {
	AdapterUnavailableError,
	EmbeddingCompatibilityError,
	type EmbedInput,
	type EmbeddingResult,
} from "@codesoul/core"
import type { Embedder } from "@codesoul/embedder"

export type FallbackEmbedderOptions = {
	/** Embedder to try first. Typically HttpEmbedder. */
	primary: Embedder
	/** Embedder to fall back to on AdapterUnavailableError. Typically MockEmbedder. */
	fallback: Embedder
	/**
	 * Optional hook fired once per fallback. Use this from the wiring layer
	 * to emit a structured pino warning and surface "degraded mode" to the
	 * user. Throwing inside the hook is allowed and aborts the call.
	 */
	onFallback?: (err: AdapterUnavailableError) => void
}

/**
 * Embedder wrapper: try `primary`, fall back to `fallback` on
 * AdapterUnavailableError (network / non-2xx / malformed JSON / timeout).
 *
 * What this wrapper does NOT do:
 *
 *   - It does NOT catch EmbeddingCompatibilityError. That class signals
 *     "server is healthy but on the wrong model"; falling back would
 *     mix identities in the vector store and silently corrupt search.
 *     Let it propagate.
 *   - It does NOT catch arbitrary Error subclasses. Programmer errors
 *     (TypeError, schema bugs, etc.) should not be masked as outages.
 *   - It does NOT rewrite the EmbeddingResult.embeddingModel /
 *     embeddingRevision tags. The fallback's actual identity is what
 *     gets persisted, so a downstream LanceDB check still has truthful
 *     identity to compare against.
 *
 * Identity getters (`modelId`, `modelRevision`, `dimension`) report the
 * primary's identity — this is what the system thinks it is configured
 * for. Production indexing should not use a fallback-wrapped embedder
 * if the fallback has a different model identity.
 */
export class FallbackEmbedder implements Embedder {
	private readonly primary: Embedder
	private readonly fallback: Embedder
	private readonly onFallback?: (err: AdapterUnavailableError) => void

	get modelId(): string {
		return this.primary.modelId
	}
	get modelRevision(): string {
		return this.primary.modelRevision
	}
	get dimension(): number {
		return this.primary.dimension
	}

	constructor(options: FallbackEmbedderOptions) {
		this.primary = options.primary
		this.fallback = options.fallback
		if (options.onFallback) this.onFallback = options.onFallback
	}

	async embed(
		inputs: ReadonlyArray<EmbedInput>,
	): Promise<EmbeddingResult[]> {
		try {
			return await this.primary.embed(inputs)
		} catch (err) {
			if (err instanceof EmbeddingCompatibilityError) throw err
			if (!(err instanceof AdapterUnavailableError)) throw err
			this.onFallback?.(err)
			return this.fallback.embed(inputs)
		}
	}
}
