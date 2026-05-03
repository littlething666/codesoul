import { randomBytes } from "node:crypto"

/**
 * Pluggable id generator for batch ids and any future random run ids.
 *
 * CryptoIdGen is the production default; tests should inject a fake to make
 * outputs byte-identical.
 */
export interface IdGen {
	batchId(): string
}

export const CryptoIdGen: IdGen = {
	batchId: () => `batch_${randomBytes(8).toString("hex")}`,
}
