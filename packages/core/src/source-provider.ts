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
