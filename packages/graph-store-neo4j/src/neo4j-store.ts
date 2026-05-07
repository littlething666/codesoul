import neo4j from "neo4j-driver"
import type { Driver, Session } from "neo4j-driver"
import type { EdgeType, GraphEdge, GraphNode } from "@codesoul/core"
import {
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
} from "@codesoul/core"
import type {
	GraphQueryResult,
	GraphStore,
	ListEdgesOptions,
	ListNodesOptions,
	TraversalOptions,
} from "@codesoul/graph-store"
import {
	EDGE_TYPES,
	fromEdgeProps,
	fromNodeProps,
	toEdgeProps,
	toNodeProps,
} from "./cypher-mapping.js"
import { NEO4J_MIGRATIONS } from "./migrations.js"

export type Neo4jGraphStoreOptions = {
	uri: string
	username: string
	password: string
	database?: string
	/**
	 * When true, every write (`upsertNodes` / `upsertEdges`) awaits an
	 * idempotent `runMigrations()` call exactly once on first use.
	 *
	 * Defaults to false so callers that bootstrap explicitly (the
	 * integration test, ops scripts) don't pay the round-trip twice.
	 * Wiring code (`apps/cli/src/wiring.ts`) sets this to true so
	 * `wireRuntime` can stay synchronous: a fresh CLI invocation against
	 * a brand-new Neo4j database doesn't require an out-of-band
	 * migration step before the first `index` run.
	 *
	 * Migrations are constraints / indexes only and every statement uses
	 * `IF NOT EXISTS`, so calling `runMigrations()` twice (once explicitly,
	 * once lazily) is safe and observable.
	 */
	autoMigrate?: boolean
}

type LayerRecord = {
	srcId: string
	dstId: string
	relType: string
	relProps: Record<string, unknown>
	otherProps: Record<string, unknown>
}

/**
 * Neo4j 5.26-LTS-backed `GraphStore` implementation.
 *
 * Layout:
 *
 *   - Single `:Symbol` label keyed by `id` (`sym_<sha1>`).
 *   - Edges stored as relationships with the closed `EdgeType` whitelist
 *     as the relationship type. Edges are grouped by type and merged in
 *     one UNWIND-batch per type so the relationship type can be
 *     interpolated statically — APOC is therefore optional, never
 *     required, per the planning doc.
 *   - All node properties live on the `:Symbol` row; `Evidence` is
 *     flattened to `evidenceStartLine` / `evidenceEndLine` and
 *     reconstructed via Zod on read (`fromNodeProps`).
 *   - `disableLosslessIntegers: true` in the driver config keeps line
 *     numbers as plain JS numbers; without it the driver hands back
 *     `neo4j.Integer` instances and `Evidence` would fail Zod parsing.
 *
 * Cypher is intentionally NOT exposed on the store. The base
 * `GraphStore` interface stays portable across backends; if a future
 * read-only Cypher escape hatch is needed for explicit debug commands,
 * it can land as a separately-typed `Neo4jReadOnlyExtensions` mixin
 * that callers opt into explicitly.
 *
 * Traversal mirrors `MockGraphStore`'s layer-complete BFS:
 *
 *   - the seed node is always included,
 *   - each layer is fully expanded before `limit` is checked,
 *   - the edge-type allow-list is applied per layer,
 *   - `direction` supports `"out"` / `"in"` / `"both"`.
 */
export class Neo4jGraphStore implements GraphStore {
	private readonly driver: Driver
	private readonly database: string
	private readonly autoMigrateEnabled: boolean
	private migrationPromise: Promise<void> | null = null

	constructor(options: Neo4jGraphStoreOptions) {
		this.driver = neo4j.driver(
			options.uri,
			neo4j.auth.basic(options.username, options.password),
			{ disableLosslessIntegers: true },
		)
		this.database = options.database ?? "neo4j"
		this.autoMigrateEnabled = options.autoMigrate ?? false
	}

	private session(): Session {
		return this.driver.session({ database: this.database })
	}

	/**
	 * Apply schema migrations idempotently. Safe to call on every startup.
	 * Migrations are constraints / indexes only; data migrations (if any)
	 * land later, keyed off the persisted `schemaVersion` property.
	 */
	async runMigrations(): Promise<void> {
		const session = this.session()
		try {
			for (const stmt of NEO4J_MIGRATIONS) {
				await session.run(stmt)
			}
		} finally {
			await session.close()
		}
	}

	/**
	 * If `autoMigrate` is on, run migrations exactly once on first write.
	 * The promise is cached so concurrent writes share the same migration
	 * round-trip instead of stampeding the database with N redundant
	 * `CREATE CONSTRAINT IF NOT EXISTS` statements.
	 */
	private async ensureMigrated(): Promise<void> {
		if (!this.autoMigrateEnabled) return
		if (!this.migrationPromise) {
			this.migrationPromise = this.runMigrations()
		}
		await this.migrationPromise
	}

	async upsertNodes(nodes: ReadonlyArray<GraphNode>): Promise<void> {
		if (nodes.length === 0) return
		await this.ensureMigrated()
		const validated = nodes.map((n) => GraphNodeSchema.parse(n))
		const params = validated.map(toNodeProps)
		const session = this.session()
		try {
			await session.executeWrite((tx) =>
				tx.run(
					`UNWIND $nodes AS n
					 MERGE (s:Symbol { id: n.id })
					 SET s = n`,
					{ nodes: params },
				),
			)
		} finally {
			await session.close()
		}
	}

	async upsertEdges(edges: ReadonlyArray<GraphEdge>): Promise<void> {
		if (edges.length === 0) return
		await this.ensureMigrated()
		const validated = edges.map((e) => GraphEdgeSchema.parse(e))
		const byType = new Map<EdgeType, GraphEdge[]>()
		for (const e of validated) {
			const list = byType.get(e.type) ?? []
			list.push(e)
			byType.set(e.type, list)
		}
		const session = this.session()
		try {
			for (const [type, list] of byType) {
				if (!EDGE_TYPES.includes(type)) continue
				const params = list.map((e) => ({
					src: e.src,
					dst: e.dst,
					props: toEdgeProps(e),
				}))
				await session.executeWrite((tx) =>
					tx.run(
						`UNWIND $edges AS e
						 MATCH (src:Symbol { id: e.src })
						 MATCH (dst:Symbol { id: e.dst })
						 MERGE (src)-[r:\`${type}\`]->(dst)
						 SET r = e.props`,
						{ edges: params },
					),
				)
			}
		} finally {
			await session.close()
		}
	}

	async getNode(id: string): Promise<GraphNode | null> {
		const session = this.session()
		try {
			const result = await session.executeRead((tx) =>
				tx.run(
					`MATCH (s:Symbol { id: $id }) RETURN properties(s) AS props LIMIT 1`,
					{ id },
				),
			)
			const record = result.records[0]
			if (!record) return null
			return fromNodeProps(
				record.get("props") as Record<string, unknown>,
			)
		} finally {
			await session.close()
		}
	}

	async findByQualifiedName(name: string): Promise<GraphNode[]> {
		const session = this.session()
		try {
			const result = await session.executeRead((tx) =>
				tx.run(
					`MATCH (s:Symbol)
					 WHERE s.qualifiedName = $name OR s.qualifiedName ENDS WITH $suffix
					 RETURN properties(s) AS props`,
					{ name, suffix: `::${name}` },
				),
			)
			return result.records.map((r) =>
				fromNodeProps(r.get("props") as Record<string, unknown>),
			)
		} finally {
			await session.close()
		}
	}

	async neighbors(
		id: string,
		options: TraversalOptions,
	): Promise<GraphQueryResult> {
		const direction = options.direction ?? "both"
		const allowed: ReadonlySet<EdgeType> | null =
			options.edgeTypes && options.edgeTypes.length > 0
				? new Set(options.edgeTypes)
				: null
		const limit =
			options.limit && options.limit > 0
				? options.limit
				: Number.POSITIVE_INFINITY

		const collectedNodes = new Map<string, GraphNode>()
		const collectedEdges = new Map<string, GraphEdge>()
		const visited = new Set<string>([id])

		const start = await this.getNode(id)
		if (start) collectedNodes.set(id, start)

		let currentLayer: string[] = [id]
		const session = this.session()
		try {
			for (let d = 0; d < options.depth; d++) {
				if (currentLayer.length === 0) break
				const records = await this.queryLayer(
					session,
					currentLayer,
					direction,
				)
				const nextLayer: string[] = []
				for (const r of records) {
					const edgeType = r.relType as EdgeType
					if (!EDGE_TYPES.includes(edgeType)) continue
					if (allowed && !allowed.has(edgeType)) continue
					const otherNode = fromNodeProps(r.otherProps)
					if (!collectedNodes.has(otherNode.id)) {
						collectedNodes.set(otherNode.id, otherNode)
					}
					const edge = fromEdgeProps(
						r.relProps,
						r.srcId,
						r.dstId,
						edgeType,
					)
					const key = `${edge.src}|${edge.type}|${edge.dst}`
					if (!collectedEdges.has(key)) {
						collectedEdges.set(key, edge)
					}
					if (!visited.has(otherNode.id)) {
						visited.add(otherNode.id)
						nextLayer.push(otherNode.id)
					}
				}
				const nonSeed = collectedNodes.size - (start ? 1 : 0)
				if (nonSeed >= limit) break
				currentLayer = nextLayer
			}
		} finally {
			await session.close()
		}

		return {
			nodes: Array.from(collectedNodes.values()),
			edges: Array.from(collectedEdges.values()),
		}
	}

	private async queryLayer(
		session: Session,
		ids: ReadonlyArray<string>,
		direction: "out" | "in" | "both",
	): Promise<LayerRecord[]> {
		let cypher: string
		if (direction === "out") {
			cypher = `UNWIND $ids AS startId
			          MATCH (start:Symbol { id: startId })-[r]->(other:Symbol)
			          RETURN start.id AS srcId,
			                 other.id AS dstId,
			                 type(r) AS relType,
			                 properties(r) AS relProps,
			                 properties(other) AS otherProps`
		} else if (direction === "in") {
			cypher = `UNWIND $ids AS startId
			          MATCH (start:Symbol { id: startId })<-[r]-(other:Symbol)
			          RETURN other.id AS srcId,
			                 start.id AS dstId,
			                 type(r) AS relType,
			                 properties(r) AS relProps,
			                 properties(other) AS otherProps`
		} else {
			cypher = `UNWIND $ids AS startId
			          MATCH (start:Symbol { id: startId })-[r]-(other:Symbol)
			          RETURN CASE WHEN startNode(r).id = startId THEN startId ELSE other.id END AS srcId,
			                 CASE WHEN startNode(r).id = startId THEN other.id ELSE startId END AS dstId,
			                 type(r) AS relType,
			                 properties(r) AS relProps,
			                 properties(other) AS otherProps`
		}
		const result = await session.executeRead((tx) =>
			tx.run(cypher, { ids: [...ids] }),
		)
		return result.records.map((rec) => ({
			srcId: String(rec.get("srcId")),
			dstId: String(rec.get("dstId")),
			relType: String(rec.get("relType")),
			relProps: rec.get("relProps") as Record<string, unknown>,
			otherProps: rec.get("otherProps") as Record<string, unknown>,
		}))
	}

	async listNodes(options: ListNodesOptions = {}): Promise<GraphNode[]> {
		const where: string[] = []
		const params: Record<string, unknown> = {}
		if (options.kind) {
			where.push("s.kind = $kind")
			params.kind = options.kind
		}
		if (options.pathPrefix) {
			where.push("s.path STARTS WITH $pathPrefix")
			params.pathPrefix = options.pathPrefix
		}
		if (options.repoId) {
			where.push("s.repoId = $repoId")
			params.repoId = options.repoId
		}
		if (options.indexRunId) {
			where.push("s.indexRunId = $indexRunId")
			params.indexRunId = options.indexRunId
		}
		const whereClause =
			where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""
		const limitClause =
			options.limit && options.limit > 0
				? `LIMIT toInteger($limit)`
				: ""
		if (limitClause) params.limit = options.limit
		const cypher = `MATCH (s:Symbol)
		                ${whereClause}
		                RETURN properties(s) AS props
		                ${limitClause}`
		const session = this.session()
		try {
			const result = await session.executeRead((tx) =>
				tx.run(cypher, params),
			)
			return result.records.map((r) =>
				fromNodeProps(r.get("props") as Record<string, unknown>),
			)
		} finally {
			await session.close()
		}
	}

	async listEdges(options: ListEdgesOptions = {}): Promise<GraphEdge[]> {
		const where: string[] = []
		const params: Record<string, unknown> = {}
		if (options.repoId) {
			where.push("r.repoId = $repoId")
			params.repoId = options.repoId
		}
		if (options.indexRunId) {
			where.push("r.indexRunId = $indexRunId")
			params.indexRunId = options.indexRunId
		}
		const typeFilter =
			options.type && EDGE_TYPES.includes(options.type)
				? `:\`${options.type}\``
				: ""
		const whereClause =
			where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""
		const limitClause =
			options.limit && options.limit > 0
				? `LIMIT toInteger($limit)`
				: ""
		if (limitClause) params.limit = options.limit
		const cypher = `MATCH (src:Symbol)-[r${typeFilter}]->(dst:Symbol)
		                ${whereClause}
		                RETURN src.id AS srcId,
		                       dst.id AS dstId,
		                       type(r) AS relType,
		                       properties(r) AS relProps
		                ${limitClause}`
		const session = this.session()
		try {
			const result = await session.executeRead((tx) =>
				tx.run(cypher, params),
			)
			return result.records.map((rec) => {
				const t = String(rec.get("relType")) as EdgeType
				return fromEdgeProps(
					rec.get("relProps") as Record<string, unknown>,
					String(rec.get("srcId")),
					String(rec.get("dstId")),
					t,
				)
			})
		} finally {
			await session.close()
		}
	}

	async health(): Promise<{ ok: boolean; details?: string }> {
		try {
			const session = this.session()
			try {
				await session.run("RETURN 1 AS ok")
				return { ok: true }
			} finally {
				await session.close()
			}
		} catch (err) {
			return { ok: false, details: String(err) }
		}
	}

	async close(): Promise<void> {
		await this.driver.close()
	}
}
