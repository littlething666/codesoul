import { createHash } from "node:crypto"

export type StableIdInput = {
	repoId: string
	relativePath: string
	symbolKind: string
	qualifiedName: string
}

export type ContentIdInput = {
	normalizedSignature: string
	normalizedBody: string
}

export type EdgeContentHashInput = {
	src: string
	type: string
	dst: string
}

export const hashParts = (parts: readonly string[]): string => {
	const h = createHash("sha1")
	for (const p of parts) {
		h.update(p)
		h.update("\u0000")
	}
	return h.digest("hex")
}

export const stableId = (input: StableIdInput): string =>
	`sym_${hashParts([input.repoId, input.relativePath, input.symbolKind, input.qualifiedName])}`

export const contentId = (input: ContentIdInput): string =>
	`cnt_${hashParts([input.normalizedSignature, input.normalizedBody])}`

// Edge identity hash: an edge is a relationship between (src, type, dst),
// not a copy of the destination's body. Pin this identity explicitly.
export const edgeContentHash = (input: EdgeContentHashInput): string =>
	`cnt_${hashParts([input.src, input.type, input.dst])}`

// Whitespace + comment normalization. Line numbers MUST NOT participate in IDs.
export const normalizeSignature = (raw: string): string =>
	raw.replace(/\s+/g, " ").trim()

export const normalizeBody = (raw: string): string =>
	raw
		.replace(/\/\/.*$/gm, "")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/#.*$/gm, "")
		.replace(/\s+/g, " ")
		.trim()
