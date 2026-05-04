import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { parse as parseYaml } from "yaml"
import { z } from "zod"
import {
	RigComponent,
	RigGraph,
	RigTarget,
	RigTest,
} from "@codesoul/core"
import type { RigExtractor } from "./extractor.js"

const RIG_FILE = "codesoul.rig.yaml"
const EXTRACTOR_NAME = "manual-yaml-rig-extractor"
const EXTRACTOR_VERSION = "0.0.0"

/**
 * Phase 7c manual-config schema. Every field is optional so partial
 * configs work, but each entry — once provided — must satisfy the
 * canonical Zod schemas in @codesoul/core. That keeps the manual
 * fallback honest: you can't sneak an unknown component `kind` or a
 * malformed target into the graph just by handwriting YAML.
 */
const ManualRigDocument = z.object({
	schemaVersion: z.literal(1).optional(),
	components: z.array(RigComponent).optional(),
	targets: z.array(RigTarget).optional(),
	tests: z.array(RigTest).optional(),
})

type ManualRigDocument = z.infer<typeof ManualRigDocument>

const emptyGraph = () => ({
	extractor: EXTRACTOR_NAME,
	extractorVersion: EXTRACTOR_VERSION,
	components: [],
	targets: [],
	tests: [],
	schemaVersion: 1 as const,
})

/**
 * Phase 7c RIG extractor for explicit, hand-authored architecture
 * configs.
 *
 * The contract is intentionally narrow: read `codesoul.rig.yaml` from
 * the repo root, parse it with `yaml@2.8.3`, validate every entry
 * against the canonical RigGraph component / target / test schemas,
 * and emit them sorted by id. Missing or malformed files are silent
 * non-matches (`canExtract` returns false; `extract` returns an empty
 * graph) so the dispatcher can compose this extractor with PackageJson
 * / PyProject / SPADE without forcing a manual file to exist.
 *
 * Authors who want to fail loudly on a bad manual file should validate
 * with `RigGraph.parse(...)` themselves before committing the YAML.
 */
export class ManualYamlRigExtractor implements RigExtractor {
	readonly name = EXTRACTOR_NAME

	async canExtract(repoPath: string): Promise<boolean> {
		return (await this.tryParse(repoPath)) !== null
	}

	async extract(repoPath: string) {
		const doc = await this.tryParse(repoPath)
		if (!doc) return emptyGraph()
		const components = [...(doc.components ?? [])].sort((a, b) =>
			a.id.localeCompare(b.id),
		)
		const targets = [...(doc.targets ?? [])].sort((a, b) =>
			a.id.localeCompare(b.id),
		)
		const tests = [...(doc.tests ?? [])].sort((a, b) =>
			a.id.localeCompare(b.id),
		)
		return {
			extractor: EXTRACTOR_NAME,
			extractorVersion: EXTRACTOR_VERSION,
			components,
			targets,
			tests,
			schemaVersion: 1 as const,
		}
	}

	private async tryParse(
		repoPath: string,
	): Promise<ManualRigDocument | null> {
		let text: string
		try {
			text = await readFile(join(repoPath, RIG_FILE), "utf8")
		} catch {
			return null
		}
		let raw: unknown
		try {
			raw = parseYaml(text)
		} catch {
			return null
		}
		if (raw === null || raw === undefined) return { schemaVersion: 1 }
		const result = ManualRigDocument.safeParse(raw)
		return result.success ? result.data : null
	}
}
