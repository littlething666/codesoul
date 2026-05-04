import type { GraphEdge, GraphNode, RigGraph } from "@codesoul/core"
import {
	GraphEdge as GraphEdgeSchema,
	GraphNode as GraphNodeSchema,
	SCHEMA_VERSION,
	contentId,
	edgeContentHash,
	normalizeBody,
	normalizeSignature,
	stableId,
} from "@codesoul/core"

export type RigBatchMeta = {
	repoId: string
	indexRunId: string
	batchId: string
}

export type RigBatchResult = {
	nodes: GraphNode[]
	edges: GraphEdge[]
}

/**
 * `RigComponent.path` is allowed to be empty by the schema but `GraphNode.path`
 * must be non-empty. Normalize the empty/root case to "." so adapters can
 * filter on `pathPrefix: "."` without surprises.
 */
const safePath = (p: string): string => (p.length === 0 ? "." : p)

/**
 * Pure (filesystem-free) materialization of a `RigGraph` into the same
 * `GraphNode` / `GraphEdge` shapes the parser emits.
 *
 * Translation rules (Phase 7e):
 *   - Every `RigComponent` lands as a `GraphNode` with `kind: "RigComponent"`.
 *     `qualifiedName` is the component id (already namespaced by the
 *     extractor: `pkg:@org/foo`, `py:fastapi`, `manual:api-service`).
 *     `path` is the component's repo-relative path; `language` is `unknown`
 *     because RIG entities are language-neutral.
 *   - Every entry in `dependsOn` becomes a `DEPENDS_ON` edge from the
 *     component to its dependency. Edges that reference components NOT
 *     present in this graph are silently dropped: external npm/PyPI deps
 *     are intentionally scoped out by the extractors, and the dispatcher
 *     can also legitimately surface manual ids that don't resolve here.
 *   - Every `RigTarget` / `RigTest` lands as a `GraphNode` with kind
 *     `RigTarget` / `RigTest` and a `DECLARED_BY` edge back to the owning
 *     component. Targets/tests whose `componentId` cannot be resolved are
 *     skipped (the component must exist in the same graph for the edge to
 *     mean anything).
 *
 * Evidence is `{ startLine: 1, endLine: 1 }` because RIG entities don't
 * carry source line ranges. `contentHash` is derived from a stable summary
 * of the entity's identity-relevant fields so re-running the dispatcher on
 * unchanged inputs produces byte-identical hashes.
 */
export const materializeRigGraph = (
	rig: RigGraph,
	meta: RigBatchMeta,
): RigBatchResult => {
	const nodes: GraphNode[] = []
	const edges: GraphEdge[] = []

	const componentNodeIdById = new Map<string, string>()
	const componentPathById = new Map<string, string>()

	for (const c of rig.components) {
		const compPath = safePath(c.path)
		const id = stableId({
			repoId: meta.repoId,
			relativePath: compPath,
			symbolKind: "RigComponent",
			qualifiedName: c.id,
		})
		componentNodeIdById.set(c.id, id)
		componentPathById.set(c.id, compPath)
		nodes.push(
			GraphNodeSchema.parse({
				id,
				contentHash: contentId({
					normalizedSignature: normalizeSignature(c.name),
					normalizedBody: normalizeBody(
						`${c.kind}|${compPath}|${[...c.dependsOn].sort().join(",")}`,
					),
				}),
				repoId: meta.repoId,
				indexRunId: meta.indexRunId,
				batchId: meta.batchId,
				sourcePath: compPath,
				schemaVersion: SCHEMA_VERSION,
				path: compPath,
				kind: "RigComponent",
				language: "unknown",
				qualifiedName: c.id,
				signature: c.name,
				evidence: { startLine: 1, endLine: 1 },
			}),
		)
	}

	for (const c of rig.components) {
		const srcId = componentNodeIdById.get(c.id)
		if (!srcId) continue
		const compPath = componentPathById.get(c.id) ?? safePath(c.path)
		for (const dep of c.dependsOn) {
			const dstId = componentNodeIdById.get(dep)
			if (!dstId) continue
			edges.push(
				GraphEdgeSchema.parse({
					src: srcId,
					dst: dstId,
					type: "DEPENDS_ON",
					repoId: meta.repoId,
					indexRunId: meta.indexRunId,
					batchId: meta.batchId,
					sourcePath: compPath,
					contentHash: edgeContentHash({
						src: srcId,
						type: "DEPENDS_ON",
						dst: dstId,
					}),
					schemaVersion: SCHEMA_VERSION,
				}),
			)
		}
	}

	for (const t of rig.targets) {
		const parentNodeId = componentNodeIdById.get(t.componentId)
		if (!parentNodeId) continue
		const compPath =
			componentPathById.get(t.componentId) ?? "."
		const id = stableId({
			repoId: meta.repoId,
			relativePath: compPath,
			symbolKind: "RigTarget",
			qualifiedName: t.id,
		})
		nodes.push(
			GraphNodeSchema.parse({
				id,
				contentHash: contentId({
					normalizedSignature: normalizeSignature(t.name),
					normalizedBody: normalizeBody(
						`${t.kind}|${t.componentId}`,
					),
				}),
				repoId: meta.repoId,
				indexRunId: meta.indexRunId,
				batchId: meta.batchId,
				sourcePath: compPath,
				schemaVersion: SCHEMA_VERSION,
				path: compPath,
				kind: "RigTarget",
				language: "unknown",
				qualifiedName: t.id,
				signature: t.name,
				evidence: { startLine: 1, endLine: 1 },
			}),
		)
		edges.push(
			GraphEdgeSchema.parse({
				src: id,
				dst: parentNodeId,
				type: "DECLARED_BY",
				repoId: meta.repoId,
				indexRunId: meta.indexRunId,
				batchId: meta.batchId,
				sourcePath: compPath,
				contentHash: edgeContentHash({
					src: id,
					type: "DECLARED_BY",
					dst: parentNodeId,
				}),
				schemaVersion: SCHEMA_VERSION,
			}),
		)
	}

	for (const t of rig.tests) {
		const parentNodeId = componentNodeIdById.get(t.componentId)
		if (!parentNodeId) continue
		const compPath =
			componentPathById.get(t.componentId) ?? "."
		const id = stableId({
			repoId: meta.repoId,
			relativePath: compPath,
			symbolKind: "RigTest",
			qualifiedName: t.id,
		})
		nodes.push(
			GraphNodeSchema.parse({
				id,
				contentHash: contentId({
					normalizedSignature: normalizeSignature(t.name),
					normalizedBody: normalizeBody(
						`${t.framework ?? ""}|${t.componentId}`,
					),
				}),
				repoId: meta.repoId,
				indexRunId: meta.indexRunId,
				batchId: meta.batchId,
				sourcePath: compPath,
				schemaVersion: SCHEMA_VERSION,
				path: compPath,
				kind: "RigTest",
				language: "unknown",
				qualifiedName: t.id,
				signature: t.name,
				evidence: { startLine: 1, endLine: 1 },
			}),
		)
		edges.push(
			GraphEdgeSchema.parse({
				src: id,
				dst: parentNodeId,
				type: "DECLARED_BY",
				repoId: meta.repoId,
				indexRunId: meta.indexRunId,
				batchId: meta.batchId,
				sourcePath: compPath,
				contentHash: edgeContentHash({
					src: id,
					type: "DECLARED_BY",
					dst: parentNodeId,
				}),
				schemaVersion: SCHEMA_VERSION,
			}),
		)
	}

	return { nodes, edges }
}
