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

const sha1 = (parts: readonly string[]): string => {
	const h = createHash("sha1")
	for (const p of parts) {
		h.update(p)
		h.update("\u0000")
	}
	return h.digest("hex")
}

export const stableId = (input: StableIdInput): string =>
	`sym_${sha1([input.repoId, input.relativePath, input.symbolKind, input.qualifiedName])}`

export const contentId = (input: ContentIdInput): string =>
	`cnt_${sha1([input.normalizedSignature, input.normalizedBody])}`

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
