import { Buffer } from "node:buffer"

/**
 * Pluggable token estimator.
 *
 * Phase 0/0.5 ships only `ByteTokenEstimator`. Real tokenizer-backed
 * estimators (Qwen3 tokenizer, tiktoken-style) plug in here without changing
 * any caller. Retrieval and context-assembly code MUST go through this
 * interface so the token budget can be enforced consistently.
 */
export interface TokenEstimator {
	estimate(text: string): number
}

/**
 * Approximation: ~3.5 UTF-8 bytes per token. Cheap, deterministic, and
 * stable across runtimes; close enough for budget trimming until a real
 * tokenizer integration lands.
 */
export class ByteTokenEstimator implements TokenEstimator {
	estimate(text: string): number {
		return Math.ceil(Buffer.byteLength(text, "utf8") / 3.5)
	}
}
