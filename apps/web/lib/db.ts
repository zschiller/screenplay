import { Pool } from "pg"

const globalForPool = globalThis as unknown as { __screenplayPgPool?: Pool }

export const pool =
  globalForPool.__screenplayPgPool ??
  new Pool({ connectionString: process.env.DATABASE_URL })

if (process.env.NODE_ENV !== "production") {
  globalForPool.__screenplayPgPool = pool
}
