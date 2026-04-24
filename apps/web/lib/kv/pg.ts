import { query } from "../db"
import type { KV, KVSetOptions } from "./types"

export function createPgKV(): KV {
  return {
    async get<T = string>(key: string): Promise<T | null> {
      const { rows } = await query<{ value: T }>(
        `SELECT value FROM kv
          WHERE key = $1 AND (expires_at IS NULL OR expires_at > NOW())
          LIMIT 1`,
        [key],
      )
      return rows[0]?.value ?? null
    },

    async set(
      key: string,
      value: unknown,
      options: KVSetOptions = {},
    ): Promise<"OK" | null> {
      const serialized = JSON.stringify(value)
      const hasExpiry = typeof options.ex === "number"
      const expiresAtSql = hasExpiry
        ? `NOW() + make_interval(secs => $3)`
        : `NULL`
      const params: unknown[] = hasExpiry
        ? [key, serialized, options.ex]
        : [key, serialized]

      if (options.nx) {
        // Claim the key if no row exists OR the existing row has expired.
        // Matches the Redis `SET key value NX EX n` contract (null = not set).
        const { rowCount } = await query(
          `INSERT INTO kv (key, value, expires_at, updated_at)
           VALUES ($1, $2::jsonb, ${expiresAtSql}, NOW())
           ON CONFLICT (key) DO UPDATE
             SET value = EXCLUDED.value,
                 expires_at = EXCLUDED.expires_at,
                 updated_at = NOW()
             WHERE kv.expires_at IS NOT NULL AND kv.expires_at <= NOW()`,
          params,
        )
        return (rowCount ?? 0) > 0 ? "OK" : null
      }

      await query(
        `INSERT INTO kv (key, value, expires_at, updated_at)
         VALUES ($1, $2::jsonb, ${expiresAtSql}, NOW())
         ON CONFLICT (key) DO UPDATE
           SET value = EXCLUDED.value,
               expires_at = EXCLUDED.expires_at,
               updated_at = NOW()`,
        params,
      )
      return "OK"
    },

    async del(key: string): Promise<void> {
      await query(`DELETE FROM kv WHERE key = $1`, [key])
    },
  }
}
