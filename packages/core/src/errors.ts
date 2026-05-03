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
