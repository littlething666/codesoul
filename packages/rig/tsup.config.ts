import { defineConfig } from "tsup"

export default defineConfig({
	entry: [
		"src/index.ts",
		"src/mock.ts",
		"src/package-json.ts",
		"src/pyproject.ts",
	],
	format: ["esm"],
	target: "node22",
	dts: true,
	sourcemap: true,
	clean: true,
})
