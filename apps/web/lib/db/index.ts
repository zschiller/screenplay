import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"
import * as schema from "./schema"

const globalForDb = globalThis as unknown as {
  __screenplayPool?: Pool
  __screenplayDb?: ReturnType<typeof drizzle<typeof schema>>
}

export const pool =
  globalForDb.__screenplayPool ??
  new Pool({ connectionString: process.env.DATABASE_URL })

export const db =
  globalForDb.__screenplayDb ?? drizzle(pool, { schema, casing: "camelCase" })

if (process.env.NODE_ENV !== "production") {
  globalForDb.__screenplayPool = pool
  globalForDb.__screenplayDb = db
}

export { schema }
