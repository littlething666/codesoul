import { readFile } from "node:fs/promises"
import { isAbsolute, join } from "node:path"

/**
 * Pluggable source-text provider.
 *
 * The graph store MUST NOT be responsible for file contents. Retrieval and
 * context assembly read snippet text through this interface so that:
 *
 *   - Phase 0/0.5 can use `MockSourceProvider` (no filesystem).
 *   - Phase 1+ can plug a `FileSystemSourceProvider`.
 *   - Future phases can plug a remote/blob-backed implementation.
 */
export interface SourceProvider {
	readRange(path: string, lines: [number, number]): Promise<string>
}

export class MockSourceProvider implements SourceProvider {
	async readRange(
		path: string,
		lines: [number, number],
	): Promise<string> {
		return `<mock source: ${path}:${lines[0]}-${lines[1]}>`
	}
}

export type FileSystemSourceProviderOptions = {
	/**
	 * Encoding used when reading files. Defaults to utf8; LanceDB / blob
	 * backends will not use this option.
	 */
	encoding?: BufferEncoding
}

/**
 * Filesystem-backed `SourceProvider`.
 *
 * - `path` arguments to `readRange` are interpreted relative to `repoRoot`
 *   unless they are already absolute. This matches the persisted shape:
 *   graph nodes carry repo-relative paths in `path` / `evidence`.
 * - Line ranges are 1-indexed and inclusive on both ends, matching
 *   `Evidence.startLine` / `Evidence.endLine`.
 * - Out-of-range / missing files fall back to `""` rather than throwing,
 *   so a stale graph reference never crashes retrieval. Adapters that
 *   want stricter semantics can wrap the provider.
 */
export class FileSystemSourceProvider implements SourceProvider {
	private readonly encoding: BufferEncoding

	constructor(
		private readonly repoRoot: string,
		options: FileSystemSourceProviderOptions = {},
	) {
		this.encoding = options.encoding ?? "utf8"
	}

	async readRange(
		path: string,
		lines: [number, number],
	): Promise<string> {
		const [startLine, endLine] = lines
		if (
			!Number.isFinite(startLine) ||
			!Number.isFinite(endLine) ||
			endLine < startLine
		) {
			return ""
		}
		const absolute = isAbsolute(path) ? path : join(this.repoRoot, path)
		let content: string
		try {
			content = await readFile(absolute, this.encoding)
		} catch {
			return ""
		}
		const all = content.split(/\r?\n/)
		const start = Math.max(1, Math.floor(startLine))
		const end = Math.min(all.length, Math.floor(endLine))
		if (end < start) return ""
		return all.slice(start - 1, end).join("\n")
	}
}
