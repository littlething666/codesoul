import { z } from "zod"

export const Candidate = z.object({
	nodeId: z.string(),
	source: z.enum(["exact", "semantic", "graph"]),
	score: z.number(),
	evidencePath: z.string(),
	evidenceLines: z.tuple([z.number().int(), z.number().int()]),
})
export type Candidate = z.infer<typeof Candidate>

export const RankedCandidate = Candidate.extend({
	rerankScore: z.number(),
})
export type RankedCandidate = z.infer<typeof RankedCandidate>

export const ContextBundle = z.object({
	query: z.string(),
	snippets: z.array(
		z.object({
			nodeId: z.string(),
			path: z.string(),
			lines: z.tuple([z.number().int(), z.number().int()]),
			text: z.string(),
		}),
	),
	citations: z.array(z.string()),
	tokenBudget: z.object({
		total: z.number().int(),
		used: z.number().int(),
	}),
})
export type ContextBundle = z.infer<typeof ContextBundle>
