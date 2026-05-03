import { describe } from "vitest"
import { SqliteManifestStore } from "../sqlite.js"
import { runManifestStoreContract } from "./contract.js"

describe("SqliteManifestStore (in-memory)", () => {
	runManifestStoreContract(
		() =>
			new SqliteManifestStore(":memory:", {
				clock: { nowIso: () => "2026-01-01T00:00:00.000Z" },
				// :memory: databases cannot use WAL; skip pragmas to keep the test fast.
				configurePragmas: false,
			}),
	)
})
