import type { VectorRow } from "@codesoul/core"
import { VectorRow as VectorRowSchema } from "@codesoul/core"
import type {
	VectorSearchFilter,
	VectorSearchHit,
	VectorStore,
} from "./store.js"

const cosine = (a: number[], b: number[]): number => {
	let dot = 0
	let na = 0
	let nb = 0
	const len = Math.min(a.length, b.length)
	for (let i = 0; i < len; i++) {
		const av = a[i] ?? 0
		const bv = b[i] ?? 0
		dot += av * bv
		na += av * av
		nb += bv * bv
	}
	if (na === 0 || nb === 0) return 0
	return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

const matches = (row: VectorRow, filter?: VectorSearchFilter): boolean => {
	if (!filter) return true
	if (filter.repoId && row.repoId !== filter.repoId) return false
	if (filter.indexRunId && row.indexRunId !== filter.indexRunId) return false
	if (filter.payloadKind && row.payloadKind !== filter.payloadKind) return false
	return true
}

export class MockVectorStore implements VectorStore {
	private readonly rows = new Map<string, VectorRow>()

	async upsert(rows: ReadonlyArray<VectorRow>): Promise<void> {
		for (const raw of rows) {
			const r = VectorRowSchema.parse(raw)
			this.rows.set(`${r.nodeId}:${r.payloadKind}`, r)
		}
	}

	async search(query: {
		vector: number[]
		limit: number
		filter?: VectorSearchFilter
	}): Promise<VectorSearchHit[]> {
		const hits: VectorSearchHit[] = []
		for (const r of this.rows.values()) {
			if (!matches(r, query.filter)) continue
			hits.push({
				nodeId: r.nodeId,
				score: cosine(query.vector, r.vector),
				payloadKind: r.payloadKind,
			})
		}
		hits.sort((a, b) => b.score - a.score)
		return hits.slice(0, query.limit)
	}

	async listByRun(
		indexRunId: string,
		options: { limit?: number } = {},
	): Promise<VectorRow[]> {
		const limit =
			options.limit && options.limit > 0
				? options.limit
				: Number.POSITIVE_INFINITY
		const out: VectorRow[] = []
		for (const r of this.rows.values()) {
			if (r.indexRunId !== indexRunId) continue
			out.push(r)
			if (out.length >= limit) break
		}
		return out
	}

	async countByRun(indexRunId: string): Promise<number> {
		let n = 0
		for (const r of this.rows.values()) {
			if (r.indexRunId === indexRunId) n++
		}
		return n
	}

	async health(): Promise<{ ok: boolean; details?: string }> {
		return { ok: true }
	}
}
