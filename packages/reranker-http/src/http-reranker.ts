import { z } from "zod"
import {
	AdapterUnavailableError,
	type Candidate,
	type RankedCandidate,
	type SourceProvider,
} from "@codesoul/core"
import type { Reranker, RerankOptions } from "@codesoul/reranker"

/**
 * Wire-level request shape sent to the configured reranker URL. Like
 * HttpEmbedder, the server receives identity (so it can log / cache by
 * nodeId) but the response only carries scores. Identity is recombined
 * client-side so the server can never forge a RankedCandidate for a
 * node it did not see.
 */
export type HttpRerankRequest = {
	modelId: string
	modelRevision: string
	query: string
	candidates: ReadonlyArray<{ nodeId: string; text: string }>
}

const HttpRerankResponseSchema = z.object({
	modelId: z.string(),
	modelRevision: z.string(),
	scores: z.array(
		z.object({
			score: z.number().finite(),
		}),
	),
})
export type HttpRerankResponse = z.infer<typeof HttpRerankResponseSchema>

export type HttpRerankerOptions = {
	/** Absolute URL of the rerank endpoint (e.g. http://localhost:8000/rerank). */
	url: string
	/** Pinned model identity. Server replies that disagree fail closed. */
	modelId: string
	/** Pinned model revision (HF commit SHA). Server replies that disagree fail closed. */
	modelRevision: string
	/**
	 * Source-text provider used to resolve snippet text for each candidate
	 * before sending to the server. Unlike HttpEmbedder, the reranker
	 * scores (query, snippet-text) pairs and so cannot operate on the
	 * Candidate metadata alone. Wire the same SourceProvider you use in
	 * retrieval (FileSystemSourceProvider in prod; MockSourceProvider in
	 * tests) so reads are consistent across the pipeline.
	 */
	sourceProvider: SourceProvider
	/** Default per-request timeout in ms. RerankOptions.timeoutMs wins per call. Default 30s. */
	timeoutMs?: number
	/** Extra request headers (e.g. auth). content-type is always set to application/json. */
	headers?: Record<string, string>
	/** Test seam for fetch. Defaults to globalThis.fetch (Node 22+ undici). */
	fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Phase 5b HTTP reranker.
 *
 * Implements the `Reranker` interface against an HTTP endpoint that
 * speaks the JSON contract above. Vendor / runtime concerns (Qwen3-
 * Reranker via vLLM, BGE rerankers, OpenAI-compatible servers) stay
 * inside the server.
 *
 * Failure surface:
 *
 *   - `AdapterUnavailableError` — network error, non-2xx response,
 *     malformed JSON, schema violation, score-count mismatch, timeout,
 *     or model identity mismatch (server is on the wrong reranker).
 *     "Reranker is broken or misconfigured; failover."
 *
 * Notes:
 *
 *   - Unlike embeddings, rerank scores are not persisted, so an identity
 *     mismatch is not the same severity as a vector-store mixed-model
 *     bug. We surface it as AdapterUnavailableError; the cross-run
 *     identity invariant lives in IngestionManifest.rerankerModel /
 *     rerankerRevision and is checked at index time, not here.
 *   - The rerank API never re-orders results. It only attaches a
 *     rerankScore to each candidate. Sorting is the caller's job
 *     (retrieve() does it today).
 *
 * Out of scope (Phase 5c): timeout / fallback / latency-logging wiring
 * at the retrieval boundary so an unhealthy reranker can degrade to the
 * mock behavior instead of crashing a query.
 */
export class HttpReranker implements Reranker {
	readonly modelId: string
	readonly modelRevision: string

	private readonly url: string
	private readonly timeoutMs: number
	private readonly headers: Record<string, string>
	private readonly fetchImpl: typeof fetch
	private readonly sourceProvider: SourceProvider

	constructor(options: HttpRerankerOptions) {
		this.url = options.url
		this.modelId = options.modelId
		this.modelRevision = options.modelRevision
		this.sourceProvider = options.sourceProvider
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
		this.headers = options.headers ?? {}
		this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
	}

	async rerank(
		query: string,
		candidates: ReadonlyArray<Candidate>,
		options?: RerankOptions,
	): Promise<RankedCandidate[]> {
		if (candidates.length === 0) return []

		const texts = await Promise.all(
			candidates.map((c) =>
				this.sourceProvider.readRange(c.evidencePath, c.evidenceLines),
			),
		)

		const body: HttpRerankRequest = {
			modelId: this.modelId,
			modelRevision: this.modelRevision,
			query,
			candidates: candidates.map((c, i) => ({
				nodeId: c.nodeId,
				text: texts[i] ?? "",
			})),
		}

		const timeoutMs = options?.timeoutMs ?? this.timeoutMs
		const controller = new AbortController()
		const timer = setTimeout(
			() => controller.abort(new Error("timeout")),
			timeoutMs,
		)

		let response: Response
		try {
			response = await this.fetchImpl(this.url, {
				method: "POST",
				headers: {
					"content-type": "application/json",
					...this.headers,
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			})
		} catch (err) {
			if (controller.signal.aborted) {
				throw new AdapterUnavailableError(
					`reranker timed out after ${timeoutMs}ms`,
					err,
				)
			}
			throw new AdapterUnavailableError(
				`reranker request failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
				err,
			)
		} finally {
			clearTimeout(timer)
		}

		if (!response.ok) {
			throw new AdapterUnavailableError(
				`reranker returned ${response.status} ${response.statusText}`,
			)
		}

		let raw: unknown
		try {
			raw = await response.json()
		} catch (err) {
			throw new AdapterUnavailableError(
				`reranker returned invalid JSON: ${
					err instanceof Error ? err.message : String(err)
				}`,
				err,
			)
		}

		const parsed = HttpRerankResponseSchema.safeParse(raw)
		if (!parsed.success) {
			throw new AdapterUnavailableError(
				`reranker response failed schema validation: ${parsed.error.message}`,
				parsed.error,
			)
		}

		const data = parsed.data
		if (
			data.modelId !== this.modelId ||
			data.modelRevision !== this.modelRevision
		) {
			throw new AdapterUnavailableError(
				`reranker identity mismatch: expected ${this.modelId}@${this.modelRevision}, got ${data.modelId}@${data.modelRevision}`,
			)
		}
		if (data.scores.length !== candidates.length) {
			throw new AdapterUnavailableError(
				`reranker returned ${data.scores.length} scores for ${candidates.length} candidates`,
			)
		}

		const out: RankedCandidate[] = []
		for (let i = 0; i < candidates.length; i++) {
			const c = candidates[i]
			const s = data.scores[i]
			if (!c || !s) continue
			out.push({ ...c, rerankScore: s.score })
		}
		return out
	}
}
