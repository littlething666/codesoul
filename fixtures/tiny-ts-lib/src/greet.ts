export function greet(name: string): string {
	return `Hello, ${name}!`
}

export function greetMany(names: string[]): string[] {
	return names.map((n) => greet(n))
}
