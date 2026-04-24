import { eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { kvStore } from "@/lib/db/schema"

export interface KVSetOptions {
  // Expiration in seconds
  ex?: number
  // Only set if the key does not already exist (used for distributed locks)
  nx?: boolean
}

// Minimal KV contract used by the app. Non-string values are JSON-serialized
// on `set` and deserialized on `get`.
export interface KV {
  get<T = string>(key: string): Promise<T | null>
  set(
    key: string,
    value: unknown,
    options?: KVSetOptions,
  ): Promise<"OK" | null>
  del(key: string): Promise<void>
}

export const kv: KV = {
  async get<T = string>(key: string): Promise<T | null> {
    const rows = await db
      .select({ value: kvStore.value, expiresAt: kvStore.expiresAt })
      .from(kvStore)
      .where(eq(kvStore.key, key))
      .limit(1)
    const row = rows[0]
    if (!row) return null
    if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
      // Lazily evict expired rows so callers don't see stale data.
      db.delete(kvStore).where(eq(kvStore.key, key)).catch(() => {})
      return null
    }
    return row.value as T
  },

  async set(key, value, options) {
    const expiresAt = options?.ex
      ? new Date(Date.now() + options.ex * 1000)
      : null

    if (options?.nx) {
      // Atomic SET-if-absent for distributed locks. The UPDATE branch only
      // fires when the existing row has already expired, so a live row
      // blocks acquisition and RETURNING comes back empty.
      const result = await db
        .insert(kvStore)
        .values({ key, value: value as unknown, expiresAt })
        .onConflictDoUpdate({
          target: kvStore.key,
          set: { value: value as unknown, expiresAt },
          setWhere: sql`${kvStore.expiresAt} IS NOT NULL AND ${kvStore.expiresAt} <= now()`,
        })
        .returning({ key: kvStore.key })
      return result.length > 0 ? "OK" : null
    }

    await db
      .insert(kvStore)
      .values({ key, value: value as unknown, expiresAt })
      .onConflictDoUpdate({
        target: kvStore.key,
        set: { value: value as unknown, expiresAt },
      })
    return "OK"
  },

  async del(key) {
    await db.delete(kvStore).where(eq(kvStore.key, key))
  },
}
