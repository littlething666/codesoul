import type {
	RigComponent,
	RigGraph,
	RigTarget,
	RigTest,
} from "@codesoul/core"
import type { RigExtractor } from "./extractor.js"

const DISPATCHER_NAME = "rig-dispatcher"
const DISPATCHER_VERSION = "0.0.0"

/**
 * Pure merge of N RigGraphs into one. Exposed alongside
 * `RigDispatcher` so callers that have already collected RigGraphs by
 * other means (cached output, replayed manifests, etc.) can reuse the
 * same merge semantics without instantiating extractors.
 *
 * Merge rules:
 *   - components / targets / tests are deduped by `id`.
 *   - first writer wins on identity fields (kind, path, name, ...).
 *   - components additionally union `dependsOn` arrays from later
 *     writers so an edge surfaced by one extractor (e.g. a manual YAML
 *     edit) never gets silently shadowed by a later one (e.g. the
 *     PackageJson extractor that doesn't see manual deps).
 *   - all collections are sorted by id for byte-stable output.
 */
export const mergeRigGraphs = (
	graphs: ReadonlyArray<RigGraph>,
): RigGraph => {
	const componentsById = new Map<string, RigComponent>()
	const targetsById = new Map<string, RigTarget>()
	const testsById = new Map<string, RigTest>()
	for (const g of graphs) {
		for (const c of g.components) {
			const existing = componentsById.get(c.id)
			if (!existing) {
				componentsById.set(c.id, {
					...c,
					dependsOn: [...c.dependsOn].sort(),
				})
				continue
			}
			const unioned = new Set<string>([
				...existing.dependsOn,
				...c.dependsOn,
			])
			componentsById.set(c.id, {
				...existing,
				dependsOn: Array.from(unioned).sort(),
			})
		}
		for (const t of g.targets) {
			if (!targetsById.has(t.id)) targetsById.set(t.id, t)
		}
		for (const t of g.tests) {
			if (!testsById.has(t.id)) testsById.set(t.id, t)
		}
	}
	const components = Array.from(componentsById.values()).sort((a, b) =>
		a.id.localeCompare(b.id),
	)
	const targets = Array.from(targetsById.values()).sort((a, b) =>
		a.id.localeCompare(b.id),
	)
	const tests = Array.from(testsById.values()).sort((a, b) =>
		a.id.localeCompare(b.id),
	)
	return {
		extractor: DISPATCHER_NAME,
		extractorVersion: DISPATCHER_VERSION,
		components,
		targets,
		tests,
		schemaVersion: 1,
	}
}

/**
 * Phase 7e foundation. `RigDispatcher` is the single entry point that
 * `wireRuntime` / `FixtureIndexer` uses:
 *
 *   const dispatcher = new RigDispatcher([
 *     new PackageJsonRigExtractor(),
 *     new PyProjectRigExtractor(),
 *     new ManualYamlRigExtractor(),
 *     // SPADE adapter (Phase 7d) plugs in here, opt-in.
 *   ])
 *
 * The dispatcher itself implements RigExtractor, so it can be passed
 * anywhere a single extractor is expected (including nested into
 * another dispatcher for layered configs).
 *
 * Materialization of the merged RigGraph into RigComponent / RigTarget
 * / RigTest GraphNodes plus DEPENDS_ON / DECLARED_BY GraphEdges remains
 * the indexer's responsibility and is the next PR.
 */
export class RigDispatcher implements RigExtractor {
	readonly name = DISPATCHER_NAME

	constructor(
		private readonly extractors: ReadonlyArray<RigExtractor>,
	) {}

	async canExtract(repoPath: string): Promise<boolean> {
		for (const e of this.extractors) {
			if (await e.canExtract(repoPath)) return true
		}
		return false
	}

	async extract(repoPath: string): Promise<RigGraph> {
		const graphs: RigGraph[] = []
		for (const e of this.extractors) {
			if (await e.canExtract(repoPath)) {
				graphs.push(await e.extract(repoPath))
			}
		}
		return mergeRigGraphs(graphs)
	}
}
