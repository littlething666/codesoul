import { Command } from "commander"
import { registerGraphExport } from "./commands/graph-export.js"
import { registerIndex } from "./commands/index.js"
import { registerInspect } from "./commands/inspect.js"
import { registerQuery } from "./commands/query.js"
import { type Phase0Deps, wirePhase0 } from "./wiring.js"

export const buildProgram = (deps: Phase0Deps = wirePhase0()): Command => {
	const program = new Command()
		.name("codesoul")
		.description("CodeSoul: repository architecture extraction layer")
		.version("0.0.0")
		.showHelpAfterError()
		.enablePositionalOptions()

	registerIndex(program, deps)
	registerQuery(program, deps)
	registerInspect(program, deps)
	registerGraphExport(program, deps)

	return program
}

export const run = async (argv: readonly string[]): Promise<void> => {
	const program = buildProgram()
	await program.parseAsync([...argv], { from: "node" })
}
