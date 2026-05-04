import { z } from "zod"
import {
	AdapterUnavailableError,
	EMBEDDING_DIM,
	EmbeddingCompatibilityError,
	type EmbedInput,
	type EmbeddingResult,
} from "@codesoul/core"
import type { Embedder } from "@codesoul/embedder"

/**
 * Wire-level request shape sent to the configured embedder URL. Kept
 * deliberately narrow: the server receives the input identity (so it can
 * log / cache by nodeId or queryId) but the response only needs to carry
 * the vectors. Identity is recombined client-side, which keeps the
 * server contract minimal and prevents the server from accidentally
 * forging an EmbeddingResult for a node it never received.
 */
export type HttpEmbedRequest = {
	modelId: string
	modelRevision: string
	dimension: number
	inputs: ReadonlyArray<
		| {
				kind: "node"
				nodeId: string
				contentHash: string
				payloadKind: "FunctionSummary" | "Block" | "Markdown"
				text: string
		  }
		| { kind: "query"; queryId: string; text: string }
	>
}

const HttpEmbedResponseSchema = z.object({
	modelId: z.string(),
	modelRevision: z.string(),
	dimension: z.number().int().positive(),
	embeddings: z.array(
		z.object({
			vector: z.array(z.number().finite()),
		}),
	),
})
export type HttpEmbedResponse = z.infer<typeof HttpEmbedResponseSchema>

export type HttpEmbedderOptions = {
	/** Absolute URL of the embed endpoint (e.g. http://localhost:8000/embed). */
	url: string
	/** Pinned model identity. Server replies that disagree fail closed. */
	modelId: string
	/** Pinned model revision (HF commit SHA). Server replies that disagree fail closed. */
	modelRevision: string
	/** Hard timeout per request in ms. Defaults to 30s. */
	timeoutMs?: number
	/** Extra request headers (e.g. auth). content-type is always set to application/json. */
	headers?: Record<string, string>
	/** Test seam for fetch. Defaults to globalThis.fetch (Node 22+ undici). */
	fetchImpl?: typeof fetch
}

const DEFAULT_TIMEOUT_MS = 30_000

/**
 * Phase 5a HTTP embedder.
 *
 * Implements the `Embedder` interface against an HTTP endpoint that
 * speaks the JSON contract above. Vendor / runtime concerns (TEI, vLLM,
 * sentence-transformers, OpenAI-compatible servers) stay inside the
 * server; this adapter knows about JSON, timeouts, and identity
 * checks, nothing else.
 *
 * Failure surface:
 *
 *   - `AdapterUnavailableError` — network error, non-2xx response,
 *     malformed JSON, schema violation, embedding-count mismatch,
 *     or timeout. "Embedder is broken; retry / failover."
 *   - `EmbeddingCompatibilityError` — server returned a vector whose
 *     model identity (modelId@modelRevision) or dimension does not
 *     match this adapter's pinned configuration. "Embedder is healthy
 *     but on the wrong model; do NOT mix these vectors with previously
 *     stored ones." Per the planning doc this is the same error class
 *     LanceDB raises on stored-vector / query-vector mismatch.
 *
 * Non-goals for this PR (tracked separately under Phase 5b/5c):
 *
 *   - Reranker. `HttpReranker` lives in a sibling package and reuses
 *     the same fail-closed identity discipline.
 *   - Fallback to mock when the URL is unreachable. The planning doc
 *     calls out that fallback must be environment-driven (local dev
 *     vs. CI vs. prod) and lives a level higher than this adapter.
 */
export class HttpEmbedder implements Embedder {
	readonly modelId: string
	readonly modelRevision: string
	readonly dimension = EMBEDDING_DIM

	private readonly url: string
	private readonly timeoutMs: number
	private readonly headers: Record<string, string>
	private readonly fetchImpl: typeof fetch

	constructor(options: HttpEmbedderOptions) {
		this.url = options.url
		this.modelId = options.modelId
		this.modelRevision = options.modelRevision
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
		this.headers = options.headers ?? {}
		this.fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis)
	}

	async embed(
		inputs: ReadonlyArray<EmbedInput>,
	): Promise<EmbeddingResult[]> {
		if (inputs.length === 0) return []

		const body: HttpEmbedRequest = {
			modelId: this.modelId,
			modelRevision: this.modelRevision,
			dimension: this.dimension,
			inputs: inputs.map((i) =>
				i.kind === "node"
					? {
							kind: "node",
							nodeId: i.nodeId,
							contentHash: i.contentHash,
							payloadKind: i.payloadKind,
							text: i.text,
						}
					: { kind: "query", queryId: i.queryId, text: i.text },
			),
		}

		const controller = new AbortController()
		const timer = setTimeout(
			() => controller.abort(new Error("timeout")),
			this.timeoutMs,
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
					`embedder timed out after ${this.timeoutMs}ms`,
					err,
				)
			}
			throw new AdapterUnavailableError(
				`embedder request failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
				err,
			)
		} finally {
			clearTimeout(timer)
		}

		if (!response.ok) {
			throw new AdapterUnavailableError(
				`embedder returned ${response.status} ${response.statusText}`,
			)
		}

		let raw: unknown
		try {
			raw = await response.json()
		} catch (err) {
			throw new AdapterUnavailableError(
				`embedder returned invalid JSON: ${
					err instanceof Error ? err.message : String(err)
				}`,
				err,
			)
		}

		const parsed = HttpEmbedResponseSchema.safeParse(raw)
		if (!parsed.success) {
			throw new AdapterUnavailableError(
				`embedder response failed schema validation: ${parsed.error.message}`,
				parsed.error,
			)
		}

		const data = parsed.data
		if (
			data.modelId !== this.modelId ||
			data.modelRevision !== this.modelRevision
		) {
			throw new EmbeddingCompatibilityError(
				`embedder identity mismatch: expected ${this.modelId}@${this.modelRevision}, got ${data.modelId}@${data.modelRevision}`,
			)
		}
		if (data.dimension !== this.dimension) {
			throw new EmbeddingCompatibilityError(
				`embedder dimension mismatch: expected ${this.dimension}, got ${data.dimension}`,
			)
		}
		if (data.embeddings.length !== inputs.length) {
			throw new AdapterUnavailableError(
				`embedder returned ${data.embeddings.length} embeddings for ${inputs.length} inputs`,
			)
		}

		const out: EmbeddingResult[] = []
		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i]
			const emb = data.embeddings[i]
			if (!input || !emb) continue
			if (emb.vector.length !== this.dimension) {
				throw new EmbeddingCompatibilityError(
					`embedder vector length mismatch at index ${i}: expected ${this.dimension}, got ${emb.vector.length}`,
				)
			}
			const base = {
				inputKind: input.kind,
				vector: emb.vector,
				embeddingModel: this.modelId,
				embeddingRevision: this.modelRevision,
				embeddingDim: this.dimension,
			} as const
			if (input.kind === "node") {
				out.push({ ...base, nodeId: input.nodeId } as EmbeddingResult)
			} else {
				out.push({
					...base,
					queryId: input.queryId,
				} as EmbeddingResult)
			}
		}
		return out
	}
}
