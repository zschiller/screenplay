import { neon } from "@neondatabase/serverless"
import { drizzle } from "drizzle-orm/neon-http"
import * as schema from "./schema"
import type { DB } from "./types"

// neon-http's `transaction()` throws ("No transactions support in neon-http
// driver"). PGlite runs it, so the shared test handle (`test/pglite.ts`) throws
// the same way, and ESLint bans the call in app code. For an atomic multi-row
// write use one statement with data-modifying CTEs, as `lib/comments.ts` does.
export function createNeonDb(): DB {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is not set")
  }
  const sql = neon(process.env.DATABASE_URL)
  return drizzle(sql, { schema })
}
