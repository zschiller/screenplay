import { createPgKV } from "./pg"
import type { KV } from "./types"

export type { KV, KVSetOptions } from "./types"

// Backed by the shared Postgres pool in lib/db.ts.
// Schema lives in lib/migrations/0002_kv.sql.
export const kv: KV = createPgKV()
