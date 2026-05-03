export function farewell(name: string): string {
	return `Goodbye, ${name}!`
}

export class Farewell {
	constructor(public readonly name: string) {}

	message(): string {
		return farewell(this.name)
	}
}
