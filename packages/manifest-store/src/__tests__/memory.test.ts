import { describe } from "vitest"
import { InMemoryManifestStore } from "../memory.js"
import { runManifestStoreContract } from "./contract.js"

describe("InMemoryManifestStore", () => {
	runManifestStoreContract(
		() =>
			new InMemoryManifestStore({
				clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
			}),
	)
})
