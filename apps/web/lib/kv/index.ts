import { createPostgresKV } from "./postgres"
import type { KV } from "./types"

export type { KV, KVSetOptions } from "./types"

// Swap providers by replacing this with your own implementation of the `KV`
// interface. See ./types.ts for the contract and ./postgres.ts for the default.
export const kv: KV = createPostgresKV()
