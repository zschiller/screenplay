import { createPostgresKV } from "./postgres"
import type { KV } from "./types"

export type { KV, KVSetOptions } from "./types"

export const kv: KV = createPostgresKV()
