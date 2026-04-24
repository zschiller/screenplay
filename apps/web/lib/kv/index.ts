import { createDrizzleKV } from "./drizzle"
import type { KV } from "./types"

export type { KV, KVSetOptions } from "./types"

// Backed by the shared Drizzle client in lib/db (hitting the `kv` table).
// Schema lives in lib/db/schema.ts; apply with `pnpm db:push`.
export const kv: KV = createDrizzleKV()
