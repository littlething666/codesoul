import { err, ok, type Result } from "../types.js"

const DURATION_PATTERN = /^(\d+(?:\.\d+)?)(ms|s|m|h)$/

export const parseDuration = (input: string): Result<number, string> => {
	const trimmed = input.trim().toLowerCase()
	const match = DURATION_PATTERN.exec(trimmed)
	if (!match) return err(`unrecognised duration: ${input}`)
	const value = Number(match[1])
	switch (match[2]) {
		case "ms":
			return ok(value)
		case "s":
			return ok(value * 1000)
		case "m":
			return ok(value * 60_000)
		case "h":
			return ok(value * 3_600_000)
		default:
			return err(`unreachable duration unit: ${match[2]}`)
	}
}

/**
 * Parse an argv-style flag list (e.g. `["--verbose", "--retries", "3"]`)
 * into a key/value map. Bare `--flag` becomes `"true"`. Values that
 * look like another flag terminate the previous flag's value capture.
 */
export const parseFlags = (
	args: ReadonlyArray<string>,
): Record<string, string> => {
	const out: Record<string, string> = {}
	let i = 0
	while (i < args.length) {
		const raw = args[i]!
		if (!raw.startsWith("--")) {
			i++
			continue
		}
		const name = raw.slice(2)
		const next = args[i + 1]
		if (next === undefined || next.startsWith("--")) {
			out[name] = "true"
			i++
		} else {
			out[name] = next
			i += 2
		}
	}
	return out
}

export const parseKeyValue = (
	input: string,
): Result<{ key: string; value: string }, string> => {
	const eq = input.indexOf("=")
	if (eq <= 0) return err(`missing '=' in key/value pair: ${input}`)
	const key = input.slice(0, eq).trim()
	const value = input.slice(eq + 1).trim()
	if (key.length === 0) return err(`empty key in key/value pair: ${input}`)
	return ok({ key, value })
}
