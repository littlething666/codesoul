import {
	spawn,
	spawnSync,
	type ChildProcess,
} from "node:child_process"
import { createServer } from "node:net"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { Candidate, SourceProvider } from "@codesoul/core"

import { HttpReranker } from "../http-reranker.js"

/**
 * Cross-language conformance test (planning doc, Phase 5).
 *
 * The Python `StubReranker` and this test's reference implementation
 * both compute Jaccard similarity over whitespace tokens:
 *
 *   q = set(query.lower().split())
 *   c = set(candidate.lower().split())
 *   score = |q ∩ c| / |q ∪ c|     (or 0.0 when the union is empty)
 *
 * JS `Number` and Python `float` are both IEEE 754 binary64 with the
 * same default rounding mode, so the spec is strong enough that the
 * scores must be **bit-identical**, not merely close. We assert that
 * directly by reinterpreting both score arrays as Float64 byte buffers
 * and `Buffer.compare`-ing them.
 *
 * Why this test exists: the wire contract is the source of truth, but
 * a contract you only ever exercise from one side rots silently. This
 * suite is the only place that exercises both ends of the JSON
 * `/rerank` contract against the same algorithmic spec; if it ever
 * stops being bit-exact we know the spec drifted somewhere (algorithm
 * change, locale-dependent split/lower behavior, encoding bug, fetch
 * coercion).
 *
 * Why we don't compare against `MockReranker` directly: the JS
 * `MockReranker` is a pass-through that copies `Candidate.score` to
 * `rerankScore`, while the Python `StubReranker` computes Jaccard.
 * Threading a `SourceProvider` through the `Reranker` interface so
 * `MockReranker` could see candidate text is a bigger surface change
 * than this conformance PR. The inline reference implementation is
 * enough to catch contract drift on either side.
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

/**
 * Reference implementation of the Python `StubReranker.rerank`
 * algorithm. MUST stay in lockstep with
 * `workers/model-server/src/codesoul_model_server/reranker.py`.
 *
 * Notes on `split()` parity:
 *   - Python `str.split()` (no args) collapses runs of whitespace and
 *     drops leading/trailing empties.
 *   - JS `string.split(/\s+/)` keeps empties at the boundaries, so we
 *     filter them out to match.
 *   - We restrict test inputs to ASCII so the lowercasing functions
 *     can't disagree on locale-sensitive code points.
 */
const jaccardScore = (query: string, candidate: string): number => {
	const tokenize = (s: string): Set<string> => {
		const tokens = new Set<string>()
		for (const t of s.toLowerCase().split(/\s+/)) {
			if (t.length > 0) tokens.add(t)
		}
		return tokens
	}
	const q = tokenize(query)
	const c = tokenize(candidate)
	const union = new Set<string>([...q, ...c])
	if (union.size === 0) return 0
	let intersection = 0
	for (const t of q) {
		if (c.has(t)) intersection++
	}
	return intersection / union.size
}

const SYM = (c: string) => `sym_${c.repeat(40)}`

describe.skipIf(!pythonAvailable)(
	"cross-language conformance: HttpReranker vs Python StubReranker (Phase 5)",
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
					reranker: {
						backend: string
						modelId: string
						modelRevision: string
					}
				}
				expect(body.ok).toBe(true)
				expect(body.reranker).toEqual({
					backend: "stub",
					modelId: "stub-reranker",
					modelRevision: "0",
				})
			},
		)

		it(
			"produces scores that are bit-identical to the JS Jaccard reference",
			{ timeout: 30_000 },
			async () => {
				const query = "greet user"

				// Cover: full overlap, partial overlap, no overlap, empty
				// candidate text, and an all-whitespace candidate (whose
				// token set is empty after split+lower+filter). Stay ASCII
				// so locale-sensitive `lower()` / `toLowerCase()` can't
				// disagree on a code point.
				const candidatesWithText: Array<{
					candidate: Candidate
					text: string
				}> = [
					{
						candidate: {
							nodeId: SYM("a"),
							source: "exact",
							score: 1,
							evidencePath: "src/a.ts",
							evidenceLines: [1, 5],
						},
						text: "greet user",
					},
					{
						candidate: {
							nodeId: SYM("b"),
							source: "semantic",
							score: 0.5,
							evidencePath: "src/b.ts",
							evidenceLines: [10, 20],
						},
						text: "GREET the user warmly with kind words",
					},
					{
						candidate: {
							nodeId: SYM("c"),
							source: "graph",
							score: 0.25,
							evidencePath: "src/c.ts",
							evidenceLines: [1, 3],
						},
						text: "completely unrelated content here",
					},
					{
						candidate: {
							nodeId: SYM("d"),
							source: "semantic",
							score: 0.1,
							evidencePath: "src/d.ts",
							evidenceLines: [1, 1],
						},
						text: "",
					},
					{
						candidate: {
							nodeId: SYM("e"),
							source: "semantic",
							score: 0.1,
							evidencePath: "src/e.ts",
							evidenceLines: [1, 1],
						},
						text: "   \t  \n  ",
					},
				]

				// Map evidence (path, lines) -> canned text so the test does
				// not need a real filesystem. HttpReranker reads candidate
				// text via SourceProvider before posting to /rerank.
				const textByEvidence = new Map<string, string>(
					candidatesWithText.map(({ candidate, text }) => [
						`${candidate.evidencePath}:${candidate.evidenceLines[0]}-${candidate.evidenceLines[1]}`,
						text,
					]),
				)

				const sourceProvider: SourceProvider = {
					async readRange(path, lines) {
						return (
							textByEvidence.get(`${path}:${lines[0]}-${lines[1]}`) ??
							""
						)
					},
				}

				const httpReranker = new HttpReranker({
					url: `${serverUrl}/rerank`,
					modelId: "stub-reranker",
					modelRevision: "0",
					sourceProvider,
				})

				const candidates = candidatesWithText.map((c) => c.candidate)
				const httpResults = await httpReranker.rerank(query, candidates)
				expect(httpResults).toHaveLength(candidates.length)

				const expectedScores = candidatesWithText.map((c) =>
					jaccardScore(query, c.text),
				)
				const httpScores = httpResults.map((r) => r.rerankScore)

				// Identity is preserved on every entry: the reranker copies
				// the original Candidate fields and only attaches rerankScore.
				for (let i = 0; i < candidates.length; i++) {
					const input = candidates[i]
					const out = httpResults[i]
					if (!input || !out) {
						throw new Error(`missing result at index ${i}`)
					}
					expect(out.nodeId).toBe(input.nodeId)
					expect(out.source).toBe(input.source)
					expect(out.evidencePath).toBe(input.evidencePath)
					expect(out.evidenceLines).toEqual(input.evidenceLines)
				}

				// Byte-for-byte compare via IEEE 754 raw bytes. JS Number
				// and Python float are both binary64; same algorithm =>
				// same bits. Float64Array.from copies into a fresh
				// ArrayBuffer at the array start, so .buffer is safe to
				// hand to Buffer.from without an offset/length pair.
				const httpBytes = Buffer.from(
					Float64Array.from(httpScores).buffer,
				)
				const expectedBytes = Buffer.from(
					Float64Array.from(expectedScores).buffer,
				)
				expect(
					Buffer.compare(httpBytes, expectedBytes),
					`scores=${JSON.stringify(httpScores)} expected=${JSON.stringify(
						expectedScores,
					)}`,
				).toBe(0)
			},
		)

		it(
			"returns [] for empty candidate list (no /rerank request issued)",
			{ timeout: 10_000 },
			async () => {
				const sourceProvider: SourceProvider = {
					async readRange() {
						throw new Error("should not be called for empty candidates")
					},
				}
				const httpReranker = new HttpReranker({
					url: `${serverUrl}/rerank`,
					modelId: "stub-reranker",
					modelRevision: "0",
					sourceProvider,
				})
				const out = await httpReranker.rerank("q", [])
				expect(out).toEqual([])
			},
		)
	},
)
