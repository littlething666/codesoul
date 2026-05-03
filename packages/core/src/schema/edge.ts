import { z } from "zod"
import { PersistedMeta } from "./meta.js"

export const EdgeType = z.enum([
	"CONTAINS",
	"CALLS",
	"IMPORTS",
	"IMPLEMENTS",
	"EXTENDS",
	"DEFINED_IN",
	"DEPENDS_ON",
	"DECLARED_BY",
])
export type EdgeType = z.infer<typeof EdgeType>

export const GraphEdge = PersistedMeta.extend({
	src: z.string().regex(/^sym_[0-9a-f]{40}$/),
	dst: z.string().regex(/^sym_[0-9a-f]{40}$/),
	type: EdgeType,
	attributes: z
		.record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
		.optional(),
})
export type GraphEdge = z.infer<typeof GraphEdge>
