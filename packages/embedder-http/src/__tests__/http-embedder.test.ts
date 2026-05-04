import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	AdapterUnavailableError,
	EMBEDDING_DIM,
	EmbeddingCompatibilityError,
	type EmbedInput,
} from "@codesoul/core"
import { HttpEmbedder } from "../http-embedder.js"

const MODEL = "Qwen/Qwen3-Embedding-0.6B"
const REVISION = "abc123"

const SYM = "sym_" + "a".repeat(40)
const CNT = "cnt_" + "0".repeat(40)

const nodeInput = (text: string): EmbedInput => ({
	kind: "node",
	nodeId: SYM,
	contentHash: CNT,
	payloadKind: "FunctionSummary",
	text,
})

const queryInput = (text: string, id = "q1"): EmbedInput => ({
	kind: "query",
	queryId: id,
	text,
})

const zeros = (n: number): number[] => new Array(n).fill(0)
const ones = (n: number): number[] => new Array(n).fill(1 / Math.sqrt(n))

type Handler = (req: IncomingMessage, res: ServerResponse) => void

let server: Server
let url: string
let handler: Handler = (_req, res) => {
	res.statusCode = 500
	res.end()
}
let lastBody: string | null = null
let lastHeaders: Record<string, string | string[] | undefined> | null = null

beforeEach(async () => {
	lastBody = null
	lastHeaders = null
	server = createServer((req, res) => {
		lastHeaders = req.headers
		const chunks: Buffer[] = []
		req.on("data", (chunk: Buffer) => chunks.push(chunk))
		req.on("end", () => {
			lastBody = Buffer.concat(chunks).toString("utf8")
			handler(req, res)
		})
	})
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
	const address = server.address() as AddressInfo
	url = `http://127.0.0.1:${address.port}/embed`
})

afterEach(async () => {
	handler = (_req, res) => {
		res.statusCode = 500
		res.end()
	}
	await new Promise<void>((resolve) => server.close(() => resolve()))
})

const respondJson = (res: ServerResponse, body: unknown, status = 200) => {
	res.statusCode = status
	res.setHeader("content-type", "application/json")
	res.end(JSON.stringify(body))
}

const makeEmbedder = (overrides: Partial<ConstructorParameters<typeof HttpEmbedder>[0]> = {}) =>
	new HttpEmbedder({
		url,
		modelId: MODEL,
		modelRevision: REVISION,
		...overrides,
	})

describe("HttpEmbedder", () => {
	it("reports the configured modelId and modelRevision and EMBEDDING_DIM", () => {
		const e = makeEmbedder()
		expect(e.modelId).toBe(MODEL)
		expect(e.modelRevision).toBe(REVISION)
		expect(e.dimension).toBe(EMBEDDING_DIM)
	})

	it("returns [] without making a request for empty input", async () => {
		handler = (_req, res) => respondJson(res, { fail: true }, 500)
		const e = makeEmbedder()
		const result = await e.embed([])
		expect(result).toEqual([])
		expect(lastBody).toBeNull()
	})

	it("round-trips a node input and tags the result with inputKind=node + nodeId", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				dimension: EMBEDDING_DIM,
				embeddings: [{ vector: zeros(EMBEDDING_DIM) }],
			})
		const e = makeEmbedder()
		const [r] = await e.embed([nodeInput("hello")])
		expect(r?.inputKind).toBe("node")
		expect(r?.nodeId).toBe(SYM)
		expect(r?.queryId).toBeUndefined()
		expect(r?.embeddingModel).toBe(MODEL)
		expect(r?.embeddingRevision).toBe(REVISION)
		expect(r?.embeddingDim).toBe(EMBEDDING_DIM)
		expect(r?.vector).toHaveLength(EMBEDDING_DIM)
	})

	it("round-trips a query input and tags the result with inputKind=query + queryId", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				dimension: EMBEDDING_DIM,
				embeddings: [{ vector: ones(EMBEDDING_DIM) }],
			})
		const e = makeEmbedder()
		const [r] = await e.embed([queryInput("greet", "q-greet")])
		expect(r?.inputKind).toBe("query")
		expect(r?.queryId).toBe("q-greet")
		expect(r?.nodeId).toBeUndefined()
	})

	it("preserves order across mixed node + query inputs", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				dimension: EMBEDDING_DIM,
				embeddings: [
					{ vector: zeros(EMBEDDING_DIM) },
					{ vector: ones(EMBEDDING_DIM) },
					{ vector: zeros(EMBEDDING_DIM) },
				],
			})
		const e = makeEmbedder()
		const out = await e.embed([
			nodeInput("a"),
			queryInput("b", "qB"),
			nodeInput("c"),
		])
		expect(out.map((r) => r.inputKind)).toEqual([
			"node",
			"query",
			"node",
		])
		expect(out[1]?.queryId).toBe("qB")
	})

	it("sends modelId, modelRevision, dimension, and inputs in the request body", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				dimension: EMBEDDING_DIM,
				embeddings: [{ vector: zeros(EMBEDDING_DIM) }],
			})
		const e = makeEmbedder()
		await e.embed([nodeInput("hello")])
		expect(lastBody).not.toBeNull()
		const parsed = JSON.parse(lastBody as string)
		expect(parsed.modelId).toBe(MODEL)
		expect(parsed.modelRevision).toBe(REVISION)
		expect(parsed.dimension).toBe(EMBEDDING_DIM)
		expect(Array.isArray(parsed.inputs)).toBe(true)
		expect(parsed.inputs[0]).toMatchObject({
			kind: "node",
			nodeId: SYM,
			contentHash: CNT,
			payloadKind: "FunctionSummary",
			text: "hello",
		})
	})

	it("sends configured headers in addition to content-type", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				dimension: EMBEDDING_DIM,
				embeddings: [{ vector: zeros(EMBEDDING_DIM) }],
			})
		const e = makeEmbedder({
			headers: { authorization: "Bearer test-token" },
		})
		await e.embed([nodeInput("hello")])
		expect(lastHeaders?.["authorization"]).toBe("Bearer test-token")
		expect(lastHeaders?.["content-type"]).toMatch(/^application\/json/)
	})

	it("throws AdapterUnavailableError on a non-2xx response", async () => {
		handler = (_req, res) => {
			res.statusCode = 503
			res.end("unavailable")
		}
		const e = makeEmbedder()
		await expect(e.embed([nodeInput("x")])).rejects.toBeInstanceOf(
			AdapterUnavailableError,
		)
	})

	it("throws AdapterUnavailableError on malformed JSON", async () => {
		handler = (_req, res) => {
			res.statusCode = 200
			res.setHeader("content-type", "application/json")
			res.end("{ not json")
		}
		const e = makeEmbedder()
		await expect(e.embed([nodeInput("x")])).rejects.toBeInstanceOf(
			AdapterUnavailableError,
		)
	})

	it("throws AdapterUnavailableError on schema mismatch (missing field)", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				dimension: EMBEDDING_DIM,
				// embeddings missing
			})
		const e = makeEmbedder()
		await expect(e.embed([nodeInput("x")])).rejects.toBeInstanceOf(
			AdapterUnavailableError,
		)
	})

	it("throws EmbeddingCompatibilityError on modelId mismatch", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: "some/other-model",
				modelRevision: REVISION,
				dimension: EMBEDDING_DIM,
				embeddings: [{ vector: zeros(EMBEDDING_DIM) }],
			})
		const e = makeEmbedder()
		await expect(e.embed([nodeInput("x")])).rejects.toBeInstanceOf(
			EmbeddingCompatibilityError,
		)
	})

	it("throws EmbeddingCompatibilityError on modelRevision mismatch", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: "def456",
				dimension: EMBEDDING_DIM,
				embeddings: [{ vector: zeros(EMBEDDING_DIM) }],
			})
		const e = makeEmbedder()
		await expect(e.embed([nodeInput("x")])).rejects.toBeInstanceOf(
			EmbeddingCompatibilityError,
		)
	})

	it("throws EmbeddingCompatibilityError on dimension mismatch", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				dimension: 768,
				embeddings: [{ vector: zeros(768) }],
			})
		const e = makeEmbedder()
		await expect(e.embed([nodeInput("x")])).rejects.toBeInstanceOf(
			EmbeddingCompatibilityError,
		)
	})

	it("throws EmbeddingCompatibilityError when an individual vector is the wrong length", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				dimension: EMBEDDING_DIM,
				embeddings: [{ vector: zeros(EMBEDDING_DIM - 1) }],
			})
		const e = makeEmbedder()
		await expect(e.embed([nodeInput("x")])).rejects.toBeInstanceOf(
			EmbeddingCompatibilityError,
		)
	})

	it("throws AdapterUnavailableError when the embedding count does not match the input count", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				dimension: EMBEDDING_DIM,
				embeddings: [
					{ vector: zeros(EMBEDDING_DIM) },
					{ vector: zeros(EMBEDDING_DIM) },
				],
			})
		const e = makeEmbedder()
		await expect(e.embed([nodeInput("x")])).rejects.toBeInstanceOf(
			AdapterUnavailableError,
		)
	})

	it("throws AdapterUnavailableError when the request times out", async () => {
		handler = (_req, _res) => {
			// Intentionally never respond; rely on the adapter's timeout to fire.
		}
		const e = makeEmbedder({ timeoutMs: 50 })
		await expect(e.embed([nodeInput("x")])).rejects.toBeInstanceOf(
			AdapterUnavailableError,
		)
	})

	it("throws AdapterUnavailableError when the underlying fetch rejects", async () => {
		const boom: typeof fetch = async () => {
			throw new Error("connect ECONNREFUSED")
		}
		const e = makeEmbedder({ fetchImpl: boom })
		await expect(e.embed([nodeInput("x")])).rejects.toBeInstanceOf(
			AdapterUnavailableError,
		)
	})
})
