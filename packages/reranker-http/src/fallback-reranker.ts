import {
	AdapterUnavailableError,
	type Candidate,
	type RankedCandidate,
} from "@codesoul/core"
import type { Reranker, RerankOptions } from "@codesoul/reranker"

export type FallbackRerankerOptions = {
	/** Reranker to try first. Typically HttpReranker. */
	primary: Reranker
	/** Reranker to fall back to on AdapterUnavailableError. Typically MockReranker. */
	fallback: Reranker
	/**
	 * Optional hook fired once per fallback. Use this from the wiring layer
	 * to emit a structured pino warning. Throwing inside the hook is
	 * allowed and aborts the call.
	 */
	onFallback?: (err: AdapterUnavailableError) => void
}

/**
 * Reranker wrapper: try `primary`, fall back to `fallback` on
 * AdapterUnavailableError (network / non-2xx / malformed JSON /
 * count-mismatch / timeout / identity-mismatch).
 *
 * Unlike FallbackEmbedder, all reranker errors are AdapterUnavailable
 * shaped — there is no separate "compatibility" class because rerank
 * scores are not persisted, so a misconfigured reranker is a transient
 * problem rather than a data-corruption one. Generic Error subclasses
 * (TypeError, etc.) still propagate.
 *
 * RerankOptions are forwarded to the primary on the first call. They
 * are not forwarded to the fallback because the mock fallback does not
 * honor a timeout (it returns synchronously). If a future fallback
 * needs options, plumb them through here.
 */
export class FallbackReranker implements Reranker {
	private readonly primary: Reranker
	private readonly fallback: Reranker
	private readonly onFallback?: (err: AdapterUnavailableError) => void

	get modelId(): string {
		return this.primary.modelId
	}
	get modelRevision(): string {
		return this.primary.modelRevision
	}

	constructor(options: FallbackRerankerOptions) {
		this.primary = options.primary
		this.fallback = options.fallback
		if (options.onFallback) this.onFallback = options.onFallback
	}

	async rerank(
		query: string,
		candidates: ReadonlyArray<Candidate>,
		options?: RerankOptions,
	): Promise<RankedCandidate[]> {
		try {
			return await this.primary.rerank(query, candidates, options)
		} catch (err) {
			if (!(err instanceof AdapterUnavailableError)) throw err
			this.onFallback?.(err)
			return this.fallback.rerank(query, candidates)
		}
	}
}
