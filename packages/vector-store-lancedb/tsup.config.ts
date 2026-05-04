import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/index.ts"],
	format: ["esm"],
	target: "node22",
	dts: true,
	sourcemap: true,
	clean: true,
	// @lancedb/lancedb is a native peer; never bundle it.
	external: ["@lancedb/lancedb"],
})
