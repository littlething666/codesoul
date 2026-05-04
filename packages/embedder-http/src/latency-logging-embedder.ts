import type { EmbedInput, EmbeddingResult } from "@codesoul/core"
import type { Embedder } from "@codesoul/embedder"

/**
 * Structural minimum of the logger contract needed by the latency
 * wrappers. pino's `Logger.info` / `Logger.warn` satisfy this shape
 * via overload resolution, so the CLI can pass its `pino.Logger`
 * straight in without this package depending on pino at runtime.
 */
export type LatencyLogger = {
	info(obj: object, msg?: string): void
	warn(obj: object, msg?: string): void
}

export type LatencyLoggingEmbedderOptions = {
	/** Embedder whose calls should be timed. */
	inner: Embedder
	/** pino-compatible logger. The wrapper only ever calls info/warn. */
	logger: LatencyLogger
	/**
	 * Clock seam. Defaults to `Date.now`. Tests inject a fake to make
	 * `durationMs` deterministic without `await sleep(...)`.
	 */
	now?: () => number
}

/**
 * Phase 5c residual: timing wrapper for any `Embedder`.
 *
 * - Successful call -> one `logger.info(record, "embedder.embed")`
 *   with `inputCount`, `resultCount`, and `durationMs`.
 * - Failed call    -> one `logger.warn(record, "embedder.embed.failed")`
 *   and the original error is rethrown so retry/fallback semantics
 *   are unchanged.
 *
 * Identity getters (`modelId`, `modelRevision`, `dimension`) forward
 * to the inner adapter. The wrapper is intentionally transparent:
 * downstream code that asks "what model is this run pinned to?"
 * still gets the truthful answer, even when wrapping a
 * `FallbackEmbedder` (which itself reports the primary's identity).
 */
export class LatencyLoggingEmbedder implements Embedder {
	private readonly inner: Embedder
	private readonly logger: LatencyLogger
	private readonly now: () => number

	get modelId(): string {
		return this.inner.modelId
	}
	get modelRevision(): string {
		return this.inner.modelRevision
	}
	get dimension(): number {
		return this.inner.dimension
	}

	constructor(options: LatencyLoggingEmbedderOptions) {
		this.inner = options.inner
		this.logger = options.logger
		this.now = options.now ?? Date.now
	}

	async embed(
		inputs: ReadonlyArray<EmbedInput>,
	): Promise<EmbeddingResult[]> {
		const startedAt = this.now()
		try {
			const result = await this.inner.embed(inputs)
			this.logger.info(
				{
					adapter: "embedder",
					modelId: this.inner.modelId,
					modelRevision: this.inner.modelRevision,
					inputCount: inputs.length,
					resultCount: result.length,
					durationMs: this.now() - startedAt,
				},
				"embedder.embed",
			)
			return result
		} catch (err) {
			this.logger.warn(
				{
					adapter: "embedder",
					modelId: this.inner.modelId,
					modelRevision: this.inner.modelRevision,
					inputCount: inputs.length,
					durationMs: this.now() - startedAt,
					err: err instanceof Error ? err.message : String(err),
				},
				"embedder.embed.failed",
			)
			throw err
		}
	}
}
