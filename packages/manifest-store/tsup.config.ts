import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts", "src/memory.ts", "src/sqlite.ts"],
	format: ["esm"],
	target: "node22",
	dts: true,
	sourcemap: true,
	clean: true,
})
