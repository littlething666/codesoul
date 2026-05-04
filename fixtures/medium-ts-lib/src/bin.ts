// Tiny CLI entrypoint exercising several fixture modules together.
// Real fixture users will run this via `tsx src/bin.ts ...`; codesoul
// itself only ever indexes the source, so the runtime behavior here
// is documentation of intent more than anything else.
import { Cache } from "./cache.js"
import { Queue } from "./queue.js"
import { formatBytes, formatDuration, formatList } from "./utils/format.js"
import { parseDuration, parseFlags } from "./utils/parse.js"
import { isOk } from "./types.js"

const main = (argv: ReadonlyArray<string>): number => {
	const flags = parseFlags(argv)
	const ttlResult = parseDuration(flags.ttl ?? "5m")
	if (!isOk(ttlResult)) {
		console.error(ttlResult.error)
		return 1
	}
	const cache = new Cache<string, number>({
		ttlMs: ttlResult.value,
		maxEntries: 64,
	})
	const queue = new Queue<string>({ capacity: 16 })
	for (const key of ["alpha", "beta", "gamma"]) {
		cache.set(key, key.length)
		queue.push(key)
	}
	console.log(
		formatList(
			[
				`cache=${cache.size} entries`,
				`queue=${queue.size} items`,
				`ttl=${formatDuration(ttlResult.value)}`,
				`heap=${formatBytes(process.memoryUsage().heapUsed)}`,
			],
			"and",
		),
	)
	return 0
}

process.exit(main(process.argv.slice(2)))
