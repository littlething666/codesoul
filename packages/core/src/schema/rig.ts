import { z } from "zod"

export const RigComponent = z.object({
	id: z.string(),
	name: z.string(),
	kind: z.enum(["package", "workspace", "app", "library", "binary"]),
	path: z.string(),
	dependsOn: z.array(z.string()),
})
export type RigComponent = z.infer<typeof RigComponent>

export const RigTarget = z.object({
	id: z.string(),
	componentId: z.string(),
	name: z.string(),
	kind: z.enum(["build", "run", "publish"]),
})
export type RigTarget = z.infer<typeof RigTarget>

export const RigTest = z.object({
	id: z.string(),
	componentId: z.string(),
	name: z.string(),
	framework: z.string().nullable(),
})
export type RigTest = z.infer<typeof RigTest>

export const RigGraph = z.object({
	extractor: z.string(),
	extractorVersion: z.string(),
	components: z.array(RigComponent),
	targets: z.array(RigTarget),
	tests: z.array(RigTest),
	schemaVersion: z.literal(1),
})
export type RigGraph = z.infer<typeof RigGraph>
