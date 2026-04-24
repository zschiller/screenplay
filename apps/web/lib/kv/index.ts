import { createUpstashKV } from "./upstash"
import type { KV } from "./types"

export type { KV, KVSetOptions } from "./types"

// Swap providers by replacing this with your own implementation of the `KV`
// interface. See ./types.ts for the contract and ./upstash.ts for a reference.
export const kv: KV = createUpstashKV()
