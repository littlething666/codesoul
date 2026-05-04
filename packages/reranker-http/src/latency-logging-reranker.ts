import type { Candidate, RankedCandidate } from "@codesoul/core"
import type { Reranker, RerankOptions } from "@codesoul/reranker"

/**
 * Structural minimum of the logger contract; matches pino's
 * `Logger.info` / `Logger.warn` overload shape so the CLI can pass
 * its `pino.Logger` straight in without making this package depend
 * on pino at runtime.
 */
export type LatencyLogger = {
	info(obj: object, msg?: string): void
	warn(obj: object, msg?: string): void
}

export type LatencyLoggingRerankerOptions = {
	/** Reranker whose calls should be timed. */
	inner: Reranker
	/** pino-compatible logger; only info/warn are used. */
	logger: LatencyLogger
	/** Clock seam (defaults to Date.now) for deterministic durationMs in tests. */
	now?: () => number
}

/**
 * Phase 5c residual: timing wrapper for any `Reranker`.
 *
 * - Success -> `logger.info({ adapter: "reranker", ..., candidateCount,
 *               durationMs }, "reranker.rerank")`.
 * - Failure -> `logger.warn({ ..., err }, "reranker.rerank.failed")`,
 *               and the original error is rethrown.
 *
 * Unlike the embedder wrapper this surface only forwards `modelId`
 * and `modelRevision` (`Reranker` has no `dimension`) and forwards
 * `RerankOptions` (notably `timeoutMs`) verbatim to the inner
 * adapter.
 */
export class LatencyLoggingReranker implements Reranker {
	private readonly inner: Reranker
	private readonly logger: LatencyLogger
	private readonly now: () => number

	get modelId(): string {
		return this.inner.modelId
	}
	get modelRevision(): string {
		return this.inner.modelRevision
	}

	constructor(options: LatencyLoggingRerankerOptions) {
		this.inner = options.inner
		this.logger = options.logger
		this.now = options.now ?? Date.now
	}

	async rerank(
		query: string,
		candidates: ReadonlyArray<Candidate>,
		options?: RerankOptions,
	): Promise<RankedCandidate[]> {
		const startedAt = this.now()
		try {
			const result = await this.inner.rerank(query, candidates, options)
			this.logger.info(
				{
					adapter: "reranker",
					modelId: this.inner.modelId,
					modelRevision: this.inner.modelRevision,
					candidateCount: candidates.length,
					durationMs: this.now() - startedAt,
				},
				"reranker.rerank",
			)
			return result
		} catch (err) {
			this.logger.warn(
				{
					adapter: "reranker",
					modelId: this.inner.modelId,
					modelRevision: this.inner.modelRevision,
					candidateCount: candidates.length,
					durationMs: this.now() - startedAt,
					err: err instanceof Error ? err.message : String(err),
				},
				"reranker.rerank.failed",
			)
			throw err
		}
	}
}
