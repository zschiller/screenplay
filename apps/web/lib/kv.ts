import { randomUUID } from "node:crypto"
import { and, eq, sql } from "drizzle-orm"
import { db } from "@/lib/db"
import { kvStore } from "@/lib/db/schema"

export interface KVSetOptions {
  // Expiration in seconds
  ex?: number
}

export interface Lock {
  release(): Promise<boolean>
}

// Minimal KV contract used by the app. Non-string values are JSON-serialized
// on `set` and deserialized on `get`.
export interface KV {
  get<T = string>(key: string): Promise<T | null>
  set(key: string, value: unknown, options?: KVSetOptions): Promise<"OK">
  del(key: string): Promise<void>
  acquireLock(key: string, ttlSec: number): Promise<Lock | null>
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
      db.delete(kvStore)
        .where(eq(kvStore.key, key))
        .catch(() => {})
      return null
    }
    return row.value as T
  },

  async set(key, value, options) {
    const expiresAt = options?.ex
      ? new Date(Date.now() + options.ex * 1000)
      : null
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

  async acquireLock(key, ttlSec) {
    // Fencing token prevents a stale holder from releasing a lock that has
    // since been acquired by someone else. The UPDATE branch only fires when
    // the existing row has already expired, so a live lock blocks acquisition
    // and RETURNING comes back empty.
    const token = randomUUID()
    const expiresAt = new Date(Date.now() + ttlSec * 1000)
    const acquired = await db
      .insert(kvStore)
      .values({ key, value: { lockToken: token }, expiresAt })
      .onConflictDoUpdate({
        target: kvStore.key,
        set: { value: { lockToken: token }, expiresAt },
        setWhere: sql`${kvStore.expiresAt} IS NOT NULL AND ${kvStore.expiresAt} <= now()`,
      })
      .returning({ key: kvStore.key })
    if (acquired.length === 0) return null

    return {
      async release() {
        const deleted = await db
          .delete(kvStore)
          .where(
            and(
              eq(kvStore.key, key),
              sql`${kvStore.value}->>'lockToken' = ${token}`
            )
          )
          .returning({ key: kvStore.key })
        return deleted.length > 0
      },
    }
  },
}
