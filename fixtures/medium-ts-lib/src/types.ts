// Shared types used across the fixture. Kept in a single file so the
// indexer is forced to resolve cross-module type-only imports, which
// is a known weak spot for naive symbol extractors.

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error"

export type Duration = {
	millis: number
}

export type KeyValuePair = {
	key: string
	value: string
}

export type Ok<T> = { ok: true; value: T }
export type Err<E> = { ok: false; error: E }
export type Result<T, E = Error> = Ok<T> | Err<E>

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value })
export const err = <E>(error: E): Err<E> => ({ ok: false, error })

export const isOk = <T, E>(r: Result<T, E>): r is Ok<T> => r.ok
export const isErr = <T, E>(r: Result<T, E>): r is Err<E> => !r.ok
