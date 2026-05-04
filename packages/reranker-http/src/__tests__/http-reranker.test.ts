import {
	createServer,
	type IncomingMessage,
	type Server,
	type ServerResponse,
} from "node:http"
import type { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
	AdapterUnavailableError,
	type Candidate,
	type SourceProvider,
} from "@codesoul/core"
import { HttpReranker } from "../http-reranker.js"

const MODEL = "Qwen/Qwen3-Reranker-0.6B"
const REVISION = "r-abc123"

const SYM = (c: string) => `sym_${c.repeat(40)}`

const cand = (nodeId: string, score = 0.5): Candidate => ({
	nodeId,
	source: "semantic",
	score,
	evidencePath: `src/${nodeId.slice(4, 6)}.ts`,
	evidenceLines: [1, 5],
})

class FakeSourceProvider implements SourceProvider {
	calls: Array<{ path: string; lines: [number, number] }> = []
	constructor(private readonly textOf: (path: string) => string = (p) => `<${p}>`) {}
	async readRange(
		path: string,
		lines: [number, number],
	): Promise<string> {
		this.calls.push({ path, lines })
		return this.textOf(path)
	}
}

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
	url = `http://127.0.0.1:${address.port}/rerank`
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

const makeReranker = (
	overrides: Partial<ConstructorParameters<typeof HttpReranker>[0]> = {},
) => {
	const sourceProvider = overrides.sourceProvider ?? new FakeSourceProvider()
	return {
		reranker: new HttpReranker({
			url,
			modelId: MODEL,
			modelRevision: REVISION,
			sourceProvider,
			...overrides,
		}),
		sourceProvider,
	}
}

describe("HttpReranker", () => {
	it("reports the configured modelId and modelRevision", () => {
		const { reranker } = makeReranker()
		expect(reranker.modelId).toBe(MODEL)
		expect(reranker.modelRevision).toBe(REVISION)
	})

	it("returns [] without making a request for empty candidates", async () => {
		handler = (_req, res) => respondJson(res, { fail: true }, 500)
		const sp = new FakeSourceProvider()
		const { reranker } = makeReranker({ sourceProvider: sp })
		const out = await reranker.rerank("q", [])
		expect(out).toEqual([])
		expect(lastBody).toBeNull()
		expect(sp.calls).toEqual([])
	})

	it("copies server scores onto each Candidate as rerankScore (preserving order)", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				scores: [{ score: 0.9 }, { score: 0.1 }, { score: 0.5 }],
			})
		const { reranker } = makeReranker()
		const out = await reranker.rerank("q", [
			cand(SYM("a")),
			cand(SYM("b")),
			cand(SYM("c")),
		])
		expect(out.map((c) => c.nodeId)).toEqual([
			SYM("a"),
			SYM("b"),
			SYM("c"),
		])
		expect(out.map((c) => c.rerankScore)).toEqual([0.9, 0.1, 0.5])
		// Original Candidate fields preserved on every entry.
		for (const c of out) {
			expect(c.source).toBe("semantic")
			expect(c.evidenceLines).toEqual([1, 5])
		}
	})

	it("sends modelId, modelRevision, query, and per-candidate text in the request body", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				scores: [{ score: 1 }],
			})
		const sp = new FakeSourceProvider((p) => `text-of-${p}`)
		const { reranker } = makeReranker({ sourceProvider: sp })
		await reranker.rerank("greet", [cand(SYM("a"))])
		expect(lastBody).not.toBeNull()
		const parsed = JSON.parse(lastBody as string)
		expect(parsed.modelId).toBe(MODEL)
		expect(parsed.modelRevision).toBe(REVISION)
		expect(parsed.query).toBe("greet")
		expect(parsed.candidates).toEqual([
			{ nodeId: SYM("a"), text: "text-of-src/aa.ts" },
		])
	})

	it("calls the SourceProvider once per candidate with the candidate's evidence path/lines", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				scores: [{ score: 1 }, { score: 0 }],
			})
		const sp = new FakeSourceProvider()
		const { reranker } = makeReranker({ sourceProvider: sp })
		const c1 = cand(SYM("a"))
		const c2 = { ...cand(SYM("b")), evidenceLines: [10, 20] as [number, number] }
		await reranker.rerank("q", [c1, c2])
		expect(sp.calls).toEqual([
			{ path: c1.evidencePath, lines: c1.evidenceLines },
			{ path: c2.evidencePath, lines: c2.evidenceLines },
		])
	})

	it("sends configured headers in addition to content-type", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				scores: [{ score: 1 }],
			})
		const { reranker } = makeReranker({
			headers: { authorization: "Bearer test-token" },
		})
		await reranker.rerank("q", [cand(SYM("a"))])
		expect(lastHeaders?.["authorization"]).toBe("Bearer test-token")
		expect(lastHeaders?.["content-type"]).toMatch(/^application\/json/)
	})

	it("throws AdapterUnavailableError on a non-2xx response", async () => {
		handler = (_req, res) => {
			res.statusCode = 503
			res.end("unavailable")
		}
		const { reranker } = makeReranker()
		await expect(
			reranker.rerank("q", [cand(SYM("a"))]),
		).rejects.toBeInstanceOf(AdapterUnavailableError)
	})

	it("throws AdapterUnavailableError on malformed JSON", async () => {
		handler = (_req, res) => {
			res.statusCode = 200
			res.setHeader("content-type", "application/json")
			res.end("{ not json")
		}
		const { reranker } = makeReranker()
		await expect(
			reranker.rerank("q", [cand(SYM("a"))]),
		).rejects.toBeInstanceOf(AdapterUnavailableError)
	})

	it("throws AdapterUnavailableError on schema mismatch", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				// scores missing
			})
		const { reranker } = makeReranker()
		await expect(
			reranker.rerank("q", [cand(SYM("a"))]),
		).rejects.toBeInstanceOf(AdapterUnavailableError)
	})

	it("throws AdapterUnavailableError on modelId mismatch", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: "some/other-reranker",
				modelRevision: REVISION,
				scores: [{ score: 1 }],
			})
		const { reranker } = makeReranker()
		await expect(
			reranker.rerank("q", [cand(SYM("a"))]),
		).rejects.toBeInstanceOf(AdapterUnavailableError)
	})

	it("throws AdapterUnavailableError on modelRevision mismatch", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: "wrong-rev",
				scores: [{ score: 1 }],
			})
		const { reranker } = makeReranker()
		await expect(
			reranker.rerank("q", [cand(SYM("a"))]),
		).rejects.toBeInstanceOf(AdapterUnavailableError)
	})

	it("throws AdapterUnavailableError when score count does not match candidate count", async () => {
		handler = (_req, res) =>
			respondJson(res, {
				modelId: MODEL,
				modelRevision: REVISION,
				scores: [{ score: 1 }],
			})
		const { reranker } = makeReranker()
		await expect(
			reranker.rerank("q", [cand(SYM("a")), cand(SYM("b"))]),
		).rejects.toBeInstanceOf(AdapterUnavailableError)
	})

	it("throws AdapterUnavailableError when the constructor-default timeout fires", async () => {
		handler = (_req, _res) => {
			// Never respond.
		}
		const { reranker } = makeReranker({ timeoutMs: 50 })
		await expect(
			reranker.rerank("q", [cand(SYM("a"))]),
		).rejects.toBeInstanceOf(AdapterUnavailableError)
	})

	it("prefers per-call RerankOptions.timeoutMs over the constructor default", async () => {
		handler = (_req, _res) => {
			// Never respond.
		}
		const { reranker } = makeReranker({ timeoutMs: 60_000 })
		const start = Date.now()
		await expect(
			reranker.rerank("q", [cand(SYM("a"))], { timeoutMs: 50 }),
		).rejects.toBeInstanceOf(AdapterUnavailableError)
		const elapsed = Date.now() - start
		// Generous upper bound; we just want to assert it didn't sit on the
		// 60s default.
		expect(elapsed).toBeLessThan(5_000)
	})

	it("throws AdapterUnavailableError when the underlying fetch rejects", async () => {
		const boom: typeof fetch = async () => {
			throw new Error("connect ECONNREFUSED")
		}
		const { reranker } = makeReranker({ fetchImpl: boom })
		await expect(
			reranker.rerank("q", [cand(SYM("a"))]),
		).rejects.toBeInstanceOf(AdapterUnavailableError)
	})
})
