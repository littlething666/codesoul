import type { LogLevel } from "./types.js"

export type CacheEntry<V> = {
	value: V
	expiresAt: number
	hits: number
}

export type CacheOptions = {
	/** Default TTL in milliseconds. Zero means "never expire". */
	ttlMs?: number
	/** Maximum number of entries; oldest are evicted first. */
	maxEntries?: number
	/** Optional log sink for cache-internal events. */
	logger?: (level: LogLevel, message: string) => void
}

/**
 * Bounded TTL cache with FIFO eviction. Pure in-memory; nothing here
 * touches the filesystem or the network, which is a deliberate fixture
 * property: the indexer must succeed on this fixture without any
 * external services running.
 */
export class Cache<K, V> {
	private readonly entries = new Map<K, CacheEntry<V>>()
	private readonly ttlMs: number
	private readonly maxEntries: number
	private readonly logger?: (level: LogLevel, message: string) => void

	constructor(options: CacheOptions = {}) {
		this.ttlMs = options.ttlMs ?? 0
		this.maxEntries = options.maxEntries ?? 1024
		this.logger = options.logger
	}

	get size(): number {
		return this.entries.size
	}

	set(key: K, value: V, ttlOverrideMs?: number): void {
		const ttl = ttlOverrideMs ?? this.ttlMs
		const expiresAt = ttl > 0 ? Date.now() + ttl : Number.POSITIVE_INFINITY
		if (this.entries.size >= this.maxEntries && !this.entries.has(key)) {
			this.evictOldest()
		}
		this.entries.set(key, { value, expiresAt, hits: 0 })
		this.log("debug", `cache.set(${String(key)})`)
	}

	get(key: K): V | undefined {
		const entry = this.entries.get(key)
		if (!entry) {
			this.log("trace", `cache.miss(${String(key)})`)
			return undefined
		}
		if (entry.expiresAt <= Date.now()) {
			this.entries.delete(key)
			this.log("debug", `cache.expire(${String(key)})`)
			return undefined
		}
		entry.hits++
		return entry.value
	}

	has(key: K): boolean {
		return this.get(key) !== undefined
	}

	delete(key: K): boolean {
		return this.entries.delete(key)
	}

	clear(): void {
		this.entries.clear()
	}

	keys(): IterableIterator<K> {
		return this.entries.keys()
	}

	private evictOldest(): void {
		const first = this.entries.keys().next()
		if (!first.done) {
			this.entries.delete(first.value)
			this.log("debug", `cache.evict(${String(first.value)})`)
		}
	}

	private log(level: LogLevel, message: string): void {
		if (this.logger) this.logger(level, message)
	}
}
