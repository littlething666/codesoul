import type { LogLevel } from "./types.js"

export type QueueOptions = {
	/** Optional fixed capacity; pushing past it throws. */
	capacity?: number
	/** Optional logger sink. */
	logger?: (level: LogLevel, message: string) => void
}

export class QueueFullError extends Error {
	constructor(capacity: number) {
		super(`queue full at capacity ${capacity}`)
		this.name = "QueueFullError"
	}
}

/**
 * Single-producer FIFO queue with optional bounded capacity.
 */
export class Queue<T> {
	private readonly items: T[] = []
	private readonly capacity: number
	private readonly logger?: (level: LogLevel, message: string) => void

	constructor(options: QueueOptions = {}) {
		this.capacity = options.capacity ?? Number.POSITIVE_INFINITY
		this.logger = options.logger
	}

	get size(): number {
		return this.items.length
	}

	get isEmpty(): boolean {
		return this.items.length === 0
	}

	push(item: T): void {
		if (this.items.length >= this.capacity) {
			throw new QueueFullError(this.capacity)
		}
		this.items.push(item)
		if (this.logger) this.logger("trace", `queue.push size=${this.items.length}`)
	}

	pop(): T | undefined {
		const item = this.items.shift()
		if (item !== undefined && this.logger) {
			this.logger("trace", `queue.pop size=${this.items.length}`)
		}
		return item
	}

	peek(): T | undefined {
		return this.items[0]
	}

	drain(): T[] {
		const drained = this.items.splice(0, this.items.length)
		if (this.logger)
			this.logger("debug", `queue.drain count=${drained.length}`)
		return drained
	}
}
