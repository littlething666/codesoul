import { spawn } from "node:child_process"
import { stat } from "node:fs/promises"
import { join } from "node:path"
import { z } from "zod"
import {
	RigComponent,
	RigExtractionError,
	RigTarget,
	RigTest,
	type RigGraph,
} from "@codesoul/core"
import type { RigExtractor } from "./extractor.js"

const EXTRACTOR_NAME = "spade-cmake-rig-extractor"
const EXTRACTOR_VERSION = "0.0.0"
const DEFAULT_BINARY = "spade"
const DEFAULT_TIMEOUT_MS = 60_000
const DEFAULT_ARGS: ReadonlyArray<string> = [
	"--rig-export",
	"--format",
	"json",
]

/**
 * Versioned JSON contract that SPADE must emit on stdout.
 *
 * Reusing the canonical `RigComponent` / `RigTarget` / `RigTest` schemas
 * from `@codesoul/core` keeps the contract honest: SPADE can never sneak
 * an unknown component kind, an out-of-enum target kind, or a malformed
 * id past the boundary. The discriminator is a literal `version: 1` so a
 * future v2 contract is a non-overlapping schema and not a quiet upgrade.
 */
export const SpadeRigOutputV1 = z.object({
	version: z.literal(1),
	components: z.array(RigComponent).default([]),
	targets: z.array(RigTarget).default([]),
	tests: z.array(RigTest).default([]),
})
export type SpadeRigOutputV1 = z.infer<typeof SpadeRigOutputV1>

export type SpadeRunArgs = {
	binary: string
	args: ReadonlyArray<string>
	cwd: string
	timeoutMs: number
}

export type SpadeRunResult = {
	stdout: string
	stderr: string
	exitCode: number
}

/**
 * Subprocess seam. The default implementation uses
 * `node:child_process.spawn`; tests inject a stub so the suite never
 * depends on a real SPADE binary being on PATH. A future PR can swap
 * this for `execa@9.6.1` (already pinned in the planning doc) without
 * touching call sites.
 */
export type SpadeRunner = (args: SpadeRunArgs) => Promise<SpadeRunResult>

export type SpadeCMakeRigExtractorOptions = {
	/** Path or PATH-resolvable name of the SPADE binary. Defaults to `"spade"`. */
	binary?: string
	/** Arguments passed to the binary. Defaults to `["--rig-export", "--format", "json"]`. */
	args?: ReadonlyArray<string>
	/** Hard timeout in ms; the child is SIGKILL'd on expiry. Default 60s. */
	timeoutMs?: number
	/** Test seam for the subprocess runner. */
	run?: SpadeRunner
}

const defaultRunner: SpadeRunner = (args) =>
	new Promise<SpadeRunResult>((resolve, reject) => {
		const child = spawn(args.binary, [...args.args], {
			cwd: args.cwd,
			stdio: ["ignore", "pipe", "pipe"],
		})
		const stdoutChunks: Buffer[] = []
		const stderrChunks: Buffer[] = []
		let timedOut = false
		let settled = false
		const timer = setTimeout(() => {
			timedOut = true
			child.kill("SIGKILL")
		}, args.timeoutMs)
		child.stdout?.on("data", (chunk: Buffer) => stdoutChunks.push(chunk))
		child.stderr?.on("data", (chunk: Buffer) => stderrChunks.push(chunk))
		child.once("error", (err) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			reject(err)
		})
		child.once("close", (code) => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			if (timedOut) {
				reject(
					new Error(
						`spade subprocess timed out after ${args.timeoutMs}ms`,
					),
				)
				return
			}
			resolve({
				stdout: Buffer.concat(stdoutChunks).toString("utf8"),
				stderr: Buffer.concat(stderrChunks).toString("utf8"),
				exitCode: code ?? -1,
			})
		})
	})

/**
 * Phase 7d RIG extractor for CMake projects, driven by the SPADE
 * subprocess.
 *
 * Contract:
 *   - `canExtract` returns true when `CMakeLists.txt` exists at the repo
 *     root. It does NOT pre-check that the SPADE binary is reachable;
 *     the user opts in by enabling `"spade"` via
 *     `IndexConfig.rigExtractors`, and a missing binary surfaces as a
 *     `RigExtractionError` from `extract` instead of a silent skip.
 *   - `extract` runs the binary, validates the JSON output against
 *     `SpadeRigOutputV1`, and folds the result into a canonical
 *     `RigGraph`. Every failure mode — subprocess error, non-zero exit,
 *     malformed JSON, missing/unknown `version`, schema violation,
 *     timeout — throws `RigExtractionError`. This matches the planning
 *     doc's "Invalid RIG output fails closed, never silently ignored"
 *     guardrail.
 *   - Output components / targets / tests are sorted by `id` for byte
 *     stability so re-running on unchanged inputs is deterministic.
 */
export class SpadeCMakeRigExtractor implements RigExtractor {
	readonly name = EXTRACTOR_NAME
	private readonly binary: string
	private readonly args: ReadonlyArray<string>
	private readonly timeoutMs: number
	private readonly run: SpadeRunner

	constructor(options: SpadeCMakeRigExtractorOptions = {}) {
		this.binary = options.binary ?? DEFAULT_BINARY
		this.args = options.args ?? DEFAULT_ARGS
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
		this.run = options.run ?? defaultRunner
	}

	async canExtract(repoPath: string): Promise<boolean> {
		try {
			const s = await stat(join(repoPath, "CMakeLists.txt"))
			return s.isFile()
		} catch {
			return false
		}
	}

	async extract(repoPath: string): Promise<RigGraph> {
		let result: SpadeRunResult
		try {
			result = await this.run({
				binary: this.binary,
				args: this.args,
				cwd: repoPath,
				timeoutMs: this.timeoutMs,
			})
		} catch (err) {
			throw new RigExtractionError(
				`SPADE subprocess failed: ${
					err instanceof Error ? err.message : String(err)
				}`,
				err,
			)
		}
		if (result.exitCode !== 0) {
			throw new RigExtractionError(
				`SPADE exited with status ${result.exitCode}: ${result.stderr.trim()}`,
			)
		}
		let parsed: unknown
		try {
			parsed = JSON.parse(result.stdout)
		} catch (err) {
			throw new RigExtractionError(
				`SPADE produced invalid JSON: ${
					err instanceof Error ? err.message : String(err)
				}`,
				err,
			)
		}
		const validation = SpadeRigOutputV1.safeParse(parsed)
		if (!validation.success) {
			throw new RigExtractionError(
				`SPADE output failed schema validation: ${validation.error.message}`,
				validation.error,
			)
		}
		const data = validation.data
		return {
			extractor: EXTRACTOR_NAME,
			extractorVersion: EXTRACTOR_VERSION,
			components: [...data.components].sort((a, b) =>
				a.id.localeCompare(b.id),
			),
			targets: [...data.targets].sort((a, b) =>
				a.id.localeCompare(b.id),
			),
			tests: [...data.tests].sort((a, b) => a.id.localeCompare(b.id)),
			schemaVersion: 1,
		}
	}
}
