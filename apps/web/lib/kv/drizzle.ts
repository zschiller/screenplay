import { and, eq, gt, isNull, or, sql } from "drizzle-orm"
import { db, schema } from "../db"
import type { KV, KVSetOptions } from "./types"

/**
 * Postgres-backed KV implemented on top of the Drizzle client.
 * Uses the `kv` table for get/del and the Drizzle-driven upsert for `set`.
 * The NX+EX path drops to a raw SQL CTE because drizzle's `onConflictDoUpdate`
 * predicate only runs once per row (not the "claim if expired" predicate we
 * need to detect whether we actually acquired the lock).
 */
export function createDrizzleKV(): KV {
  return {
    async get<T = string>(key: string): Promise<T | null> {
      const [row] = await db
        .select({ value: schema.kv.value })
        .from(schema.kv)
        .where(
          and(
            eq(schema.kv.key, key),
            or(isNull(schema.kv.expiresAt), gt(schema.kv.expiresAt, new Date())),
          ),
        )
        .limit(1)
      return (row?.value as T | null) ?? null
    },

    async set(
      key: string,
      value: unknown,
      options: KVSetOptions = {},
    ): Promise<"OK" | null> {
      const expiresAt =
        typeof options.ex === "number"
          ? new Date(Date.now() + options.ex * 1000)
          : null

      if (options.nx) {
        // Claim the key if no row exists OR the existing row has expired.
        // Matches the Redis `SET key value NX EX n` contract (null = not set).
        const result = await db.execute<{ claimed: number }>(sql`
          INSERT INTO "kv" ("key", "value", "expires_at", "updated_at")
          VALUES (${key}, ${value}::jsonb, ${expiresAt}, NOW())
          ON CONFLICT ("key") DO UPDATE
            SET "value" = EXCLUDED."value",
                "expires_at" = EXCLUDED."expires_at",
                "updated_at" = NOW()
            WHERE "kv"."expires_at" IS NOT NULL AND "kv"."expires_at" <= NOW()
          RETURNING 1 AS claimed
        `)
        return result.rows.length > 0 ? "OK" : null
      }

      await db
        .insert(schema.kv)
        .values({ key, value, expiresAt })
        .onConflictDoUpdate({
          target: schema.kv.key,
          set: { value, expiresAt, updatedAt: new Date() },
        })
      return "OK"
    },

    async del(key: string): Promise<void> {
      await db.delete(schema.kv).where(eq(schema.kv.key, key))
    },
  }
}
