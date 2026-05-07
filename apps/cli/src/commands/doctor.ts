import type { Command } from "commander"
import type { RuntimeDeps } from "../wiring.js"

type DoctorResult = {
	component: string
	ok: boolean
	details?: string | undefined
}

export const registerDoctor = (program: Command, deps: RuntimeDeps): void => {
	program
		.command("doctor")
		.description("Check health of all configured backends")
		.action(async () => {
			const results: DoctorResult[] = []

			// Manifest store
			const manifestHealth = await deps.manifestStore.health()
			results.push({
				component: `manifestStore (${deps.config.manifestStore})`,
				ok: manifestHealth.ok,
				details: manifestHealth.details,
			})

			// Graph store
			const graphHealth = await deps.graph.health()
			results.push({
				component: `graphStore (${deps.config.graphStore})`,
				ok: graphHealth.ok,
				details: graphHealth.details,
			})

			// Vector store
			const vectorHealth = await deps.vectors.health()
			results.push({
				component: `vectorStore (${deps.config.vectorStore})`,
				ok: vectorHealth.ok,
				details: vectorHealth.details,
			})

			const allOk = results.every((r) => r.ok)
			console.log(
				JSON.stringify(
					{
						status: allOk ? "healthy" : "degraded",
						checks: results,
					},
					null,
					2,
				),
			)
		})
}
