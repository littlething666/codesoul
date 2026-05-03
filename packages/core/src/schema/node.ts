import { z } from "zod"
import { PersistedMeta } from "./meta.js"

export const NodeKind = z.enum([
	"File",
	"Module",
	"Class",
	"Function",
	"Method",
	"Import",
	"Block",
	"RigComponent",
	"RigTarget",
	"RigTest",
])
export type NodeKind = z.infer<typeof NodeKind>

export const Language = z.enum([
	"typescript",
	"javascript",
	"python",
	"markdown",
	"unknown",
])
export type Language = z.infer<typeof Language>

export const Evidence = z
	.object({
		startLine: z.number().int().positive(),
		endLine: z.number().int().positive(),
	})
	.refine((v) => v.endLine >= v.startLine, {
		message: "endLine must be >= startLine",
	})
export type Evidence = z.infer<typeof Evidence>

export const GraphNode = PersistedMeta.extend({
	id: z.string().regex(/^sym_[0-9a-f]{40}$/),
	path: z.string().min(1),
	kind: NodeKind,
	language: Language,
	qualifiedName: z.string().min(1),
	signature: z.string(),
	evidence: Evidence,
})
export type GraphNode = z.infer<typeof GraphNode>
