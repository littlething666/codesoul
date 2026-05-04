import type { EdgeType, GraphEdge, GraphNode } from "@codesoul/core"
import {
	EdgeType as EdgeTypeSchema,
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
} from "@codesoul/core"

/**
 * Closed whitelist of edge types. Used as the relationship type when
 * UNWIND-merging edges so we can interpolate the type into Cypher
 * statically without depending on APOC for dynamic relationship types.
 *
 * Sourced from the canonical `EdgeType` Zod enum so any future addition
 * to the schema flows through automatically.
 */
export const EDGE_TYPES: ReadonlyArray<EdgeType> = EdgeTypeSchema.options

const ATTR_JSON_PROP = "__attrJson"

/**
 * Flat property bag stored on a `:Symbol` row.
 *
 * Neo4j only accepts primitive scalar properties (and arrays of
 * scalars), so `Evidence` is flattened to `evidenceStartLine` /
 * `evidenceEndLine` and reconstructed by `fromNodeProps`.
 */
export type Neo4jNodeProps = {
	id: string
	contentHash: string
	repoId: string
	indexRunId: string
	batchId: string
	sourcePath: string
	schemaVersion: number
	path: string
	kind: string
	language: string
	qualifiedName: string
	signature: string
	evidenceStartLine: number
	evidenceEndLine: number
}

export const toNodeProps = (node: GraphNode): Neo4jNodeProps => ({
	id: node.id,
	contentHash: node.contentHash,
	repoId: node.repoId,
	indexRunId: node.indexRunId,
	batchId: node.batchId,
	sourcePath: node.sourcePath,
	schemaVersion: node.schemaVersion,
	path: node.path,
	kind: node.kind,
	language: node.language,
	qualifiedName: node.qualifiedName,
	signature: node.signature,
	evidenceStartLine: node.evidence.startLine,
	evidenceEndLine: node.evidence.endLine,
})

export const fromNodeProps = (
	props: Record<string, unknown>,
): GraphNode =>
	GraphNodeSchema.parse({
		id: props.id,
		contentHash: props.contentHash,
		repoId: props.repoId,
		indexRunId: props.indexRunId,
		batchId: props.batchId,
		sourcePath: props.sourcePath,
		schemaVersion: 1,
		path: props.path,
		kind: props.kind,
		language: props.language,
		qualifiedName: props.qualifiedName,
		signature: props.signature,
		evidence: {
			startLine: Number(props.evidenceStartLine),
			endLine: Number(props.evidenceEndLine),
		},
	})

/**
 * Flat property bag stored on a relationship.
 *
 * `src` / `dst` / `type` live on the relationship's endpoints / type,
 * not in the property bag. The optional `attributes` map on `GraphEdge`
 * round-trips through a single JSON-encoded `__attrJson` property so we
 * never have to widen the schema's allowed value union.
 */
export type Neo4jEdgeProps = {
	contentHash: string
	repoId: string
	indexRunId: string
	batchId: string
	sourcePath: string
	schemaVersion: number
	[ATTR_JSON_PROP]?: string
}

export const toEdgeProps = (edge: GraphEdge): Neo4jEdgeProps => {
	const props: Neo4jEdgeProps = {
		contentHash: edge.contentHash,
		repoId: edge.repoId,
		indexRunId: edge.indexRunId,
		batchId: edge.batchId,
		sourcePath: edge.sourcePath,
		schemaVersion: edge.schemaVersion,
	}
	if (edge.attributes) {
		props[ATTR_JSON_PROP] = JSON.stringify(edge.attributes)
	}
	return props
}

export const fromEdgeProps = (
	props: Record<string, unknown>,
	src: string,
	dst: string,
	type: EdgeType,
): GraphEdge => {
	const raw = props[ATTR_JSON_PROP]
	let attributes: GraphEdge["attributes"]
	if (typeof raw === "string" && raw.length > 0) {
		try {
			const parsed = JSON.parse(raw) as Record<string, unknown>
			const out: Record<string, string | number | boolean> = {}
			for (const [k, v] of Object.entries(parsed)) {
				if (
					typeof v === "string" ||
					typeof v === "number" ||
					typeof v === "boolean"
				) {
					out[k] = v
				}
			}
			if (Object.keys(out).length > 0) attributes = out
		} catch {
			attributes = undefined
		}
	}
	return GraphEdgeSchema.parse({
		src,
		dst,
		type,
		contentHash: props.contentHash,
		repoId: props.repoId,
		indexRunId: props.indexRunId,
		batchId: props.batchId,
		sourcePath: props.sourcePath,
		schemaVersion: 1,
		...(attributes ? { attributes } : {}),
	})
}
