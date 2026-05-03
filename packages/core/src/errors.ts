export class CodeSoulError extends Error {
	constructor(
		message: string,
		readonly cause?: unknown,
	) {
		super(message)
		this.name = new.target.name
	}
}

export class SchemaValidationError extends CodeSoulError {}
export class ManifestStateError extends CodeSoulError {}
export class AdapterUnavailableError extends CodeSoulError {}
export class RigExtractionError extends CodeSoulError {}

/**
 * Thrown when a vector store is asked to search with a query embedding whose
 * model identity does not match the stored vectors' model identity.
 *
 * Phase 0/0.5 mocks do not enforce this; the LanceDB adapter (and any other
 * real adapter that mixes models) MUST raise this error on mismatch instead
 * of silently producing garbage hits.
 */
export class EmbeddingCompatibilityError extends CodeSoulError {}
