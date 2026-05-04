/**
 * Formatting helpers used elsewhere in the fixture. Pure functions
 * only — no I/O, no Date.now() except where the contract requires it.
 */

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

export const formatBytes = (bytes: number, decimals = 1): string => {
	if (!Number.isFinite(bytes) || bytes < 0) return "0 B"
	if (bytes < 1024) return `${bytes} B`
	let value = bytes
	let unit = 0
	while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
		value /= 1024
		unit++
	}
	return `${value.toFixed(decimals)} ${BYTE_UNITS[unit]}`
}

export const formatDuration = (millis: number): string => {
	if (!Number.isFinite(millis) || millis < 0) return "0ms"
	if (millis < 1000) return `${Math.round(millis)}ms`
	const seconds = millis / 1000
	if (seconds < 60) return `${seconds.toFixed(2)}s`
	const minutes = seconds / 60
	if (minutes < 60) return `${minutes.toFixed(2)}m`
	const hours = minutes / 60
	return `${hours.toFixed(2)}h`
}

export const formatList = (
	items: ReadonlyArray<string>,
	conjunction: "and" | "or" = "and",
): string => {
	if (items.length === 0) return ""
	if (items.length === 1) return items[0]!
	if (items.length === 2) return `${items[0]} ${conjunction} ${items[1]}`
	const head = items.slice(0, -1).join(", ")
	const tail = items[items.length - 1]
	return `${head}, ${conjunction} ${tail}`
}

export const truncate = (s: string, max: number): string => {
	if (max <= 0) return ""
	if (s.length <= max) return s
	if (max <= 1) return s.slice(0, max)
	return `${s.slice(0, max - 1)}\u2026`
}
