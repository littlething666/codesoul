import {
	spawn,
	spawnSync,
	type ChildProcess,
} from "node:child_process"
import { createServer } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { EmbedInput } from "@codesoul/core"
import { MockEmbedder } from "@codesoul/embedder/mock"

import { HttpEmbedder } from "../http-embedder.js"

/**
 * Cross-language conformance test (planning doc, Phase 5).
 *
 * Both stub backends — the JS `MockEmbedder` and the Python
 * `StubEmbedder` — implement the same algorithm:
 *
 *   for i in 0..D:
 *     h = SHA256(utf8(text) || 0x00 || ascii(str(i)))
 *     n = uint32_be(h[0:4])
 *     v[i] = (n / 0xFFFFFFFF) * 2 - 1
 *
 * JS `Number` and Python `float` are both IEEE 754 binary64 with the
 * same default rounding mode, so the spec is strong enough that the
 * vectors must be **bit-identical**, not merely close. We assert that
 * directly by reinterpreting both vectors as Float64 byte buffers and
 * `Buffer.compare`-ing them.
 *
 * Why this test exists: the wire contract is the source of truth, but
 * a contract you only ever exercise from one side rots silently. This
 * suite is the only place that exercises both ends of the JSON
 * contract against the same algorithmic spec; if it ever stops being
 * bit-exact we know the spec drifted somewhere (algorithm change,
 * locale-dependent str() formatting, encoding bug, fetch coercion).
 */

const PYTHON_BIN = process.env.CODESOUL_PYTHON_BIN ?? "python3"

const detectPythonModelServer = (): boolean => {
	try {
		const result = spawnSync(
			PYTHON_BIN,
			["-c", "import codesoul_model_server"],
			{ stdio: "ignore" },
		)
		return result.status === 0
	} catch {
		return false
	}
}

// Probe at module load. Vitest re-loads test files per worker, so this
// stays fresh across runs without leaking state between tests.
const pythonAvailable = detectPythonModelServer()

const findFreePort = async (): Promise<number> =>
	new Promise<number>((resolve, reject) => {
		const srv = createServer()
		srv.unref()
		srv.once("error", reject)
		srv.listen(0, "127.0.0.1", () => {
			const addr = srv.address()
			if (addr === null || typeof addr === "string") {
				srv.close()
				reject(new Error("could not determine free port"))
				return
			}
			const port = addr.port
			srv.close(() => resolve(port))
		})
	})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const waitForHealth = async (
	url: string,
	deadlineMs: number,
): Promise<void> => {
	const end = Date.now() + deadlineMs
	let lastErr: unknown = null
	while (Date.now() < end) {
		try {
			const res = await fetch(url)
			if (res.ok) return
			lastErr = new Error(`status ${res.status}`)
		} catch (err) {
			lastErr = err
		}
		await sleep(200)
	}
	throw new Error(
		`model server /health timed out: ${
			lastErr instanceof Error ? lastErr.message : String(lastErr)
		}`,
	)
}

describe.skipIf(!pythonAvailable)(
	"cross-language conformance: HttpEmbedder vs MockEmbedder (Phase 5)",
	() => {
		let serverProc: ChildProcess | undefined
		let serverUrl: string

		beforeAll(async () => {
			const port = await findFreePort()
			serverUrl = `http://127.0.0.1:${port}`

			serverProc = spawn(PYTHON_BIN, ["-m", "codesoul_model_server"], {
				env: {
					...process.env,
					CODESOUL_MODEL_SERVER_HOST: "127.0.0.1",
					CODESOUL_MODEL_SERVER_PORT: String(port),
					// State stub backend identity explicitly so an operator's
					// shell env can never silently switch the test onto a
					// real model.
					CODESOUL_MODEL_SERVER_EMBEDDER_BACKEND: "stub",
					CODESOUL_MODEL_SERVER_EMBEDDER_MODEL_ID: "stub-embedder",
					CODESOUL_MODEL_SERVER_EMBEDDER_MODEL_REVISION: "0",
					CODESOUL_MODEL_SERVER_RERANKER_BACKEND: "stub",
					CODESOUL_MODEL_SERVER_RERANKER_MODEL_ID: "stub-reranker",
					CODESOUL_MODEL_SERVER_RERANKER_MODEL_REVISION: "0",
					// Quiet uvicorn down so test output stays focused.
					CODESOUL_MODEL_SERVER_LOG_LEVEL: "warning",
				},
				stdio: ["ignore", "ignore", "pipe"],
			})

			// Forward stderr so a startup crash actually prints into the
			// test runner instead of vanishing into the void.
			serverProc.stderr?.on("data", (chunk: Buffer) => {
				process.stderr.write(`[model-server] ${chunk.toString("utf8")}`)
			})
			serverProc.on("error", (err) => {
				process.stderr.write(
					`[model-server] spawn error: ${err.message}\n`,
				)
			})

			await waitForHealth(`${serverUrl}/health`, 30_000)
		}, 60_000)

		afterAll(async () => {
			if (!serverProc) return
			if (serverProc.exitCode !== null) return

			serverProc.kill("SIGTERM")
			// Give uvicorn a beat to drain. Escalate if it hangs so the
			// test runner does not get stuck behind a zombie process.
			for (let i = 0; i < 25; i++) {
				if (serverProc.exitCode !== null) break
				await sleep(100)
			}
			if (serverProc.exitCode === null) {
				serverProc.kill("SIGKILL")
			}
		})

		it(
			"reports stub identity from /health",
			{ timeout: 10_000 },
			async () => {
				const res = await fetch(`${serverUrl}/health`)
				expect(res.ok).toBe(true)
				const body = (await res.json()) as {
					ok: boolean
					embedder: {
						backend: string
						modelId: string
						modelRevision: string
					}
					reranker: {
						backend: string
						modelId: string
						modelRevision: string
					}
				}
				expect(body.ok).toBe(true)
				expect(body.embedder).toEqual({
					backend: "stub",
					modelId: "stub-embedder",
					modelRevision: "0",
				})
			},
		)

		it(
			"produces vectors that are bit-identical to MockEmbedder",
			{ timeout: 30_000 },
			async () => {
				// Cover ASCII, empty string, multi-byte UTF-8, and emoji so
				// any encoding bug on either side surfaces immediately.
				const inputs: EmbedInput[] = [
					{
						kind: "node",
						nodeId: "n1",
						contentHash: "h1",
						payloadKind: "FunctionSummary",
						text: "hello world",
					},
					{
						kind: "node",
						nodeId: "n2",
						contentHash: "h2",
						payloadKind: "Block",
						text: "the quick brown fox jumps over the lazy dog",
					},
					{ kind: "query", queryId: "q-empty", text: "" },
					{
						kind: "query",
						queryId: "q-cyrillic",
						text: "\u041f\u0440\u0438\u0432\u0435\u0442, \u043c\u0438\u0440",
					},
					{
						kind: "query",
						queryId: "q-emoji",
						text: "\ud83e\udd80\ud83d\ude80",
					},
				]

				const httpEmbedder = new HttpEmbedder({
					url: `${serverUrl}/embed`,
					modelId: "stub-embedder",
					modelRevision: "0",
				})
				const mockEmbedder = new MockEmbedder()

				const [httpResults, mockResults] = await Promise.all([
					httpEmbedder.embed(inputs),
					mockEmbedder.embed(inputs),
				])

				expect(httpResults).toHaveLength(inputs.length)
				expect(mockResults).toHaveLength(inputs.length)

				for (let i = 0; i < inputs.length; i++) {
					const http = httpResults[i]
					const mock = mockResults[i]
					const input = inputs[i]
					if (!http || !mock || !input) {
						throw new Error(`missing result at index ${i}`)
					}

					// Identity is recombined client-side from the original
					// input. It must match the input row on both embedders.
					expect(http.embeddingDim).toBe(mock.embeddingDim)
					expect(http.inputKind).toBe(input.kind)
					expect(mock.inputKind).toBe(input.kind)
					expect(http.embeddingModel).toBe(mock.embeddingModel)
					expect(http.embeddingRevision).toBe(mock.embeddingRevision)
					if (input.kind === "node" && http.inputKind === "node" && mock.inputKind === "node") {
						expect(http.nodeId).toBe(input.nodeId)
						expect(mock.nodeId).toBe(input.nodeId)
					}
					if (
						input.kind === "query" &&
						http.inputKind === "query" &&
						mock.inputKind === "query"
					) {
						expect(http.queryId).toBe(input.queryId)
						expect(mock.queryId).toBe(input.queryId)
					}

					expect(http.vector).toHaveLength(http.embeddingDim)
					expect(mock.vector).toHaveLength(mock.embeddingDim)

					// Byte-for-byte compare via IEEE 754 raw bytes. JS Number
					// and Python float are both binary64; same algorithm =>
					// same bits. Float64Array.from copies into a fresh
					// ArrayBuffer at the array start, so .buffer is safe to
					// hand to Buffer.from without an offset/length pair.
					const httpBytes = Buffer.from(
						Float64Array.from(http.vector).buffer,
					)
					const mockBytes = Buffer.from(
						Float64Array.from(mock.vector).buffer,
					)
					expect(
						Buffer.compare(httpBytes, mockBytes),
						`vector mismatch at index ${i} (kind=${input.kind})`,
					).toBe(0)
				}
			},
		)
	},
)
