import { sql } from "drizzle-orm"

import { createPgliteDb } from "@/lib/db/pglite"
import type { DB } from "@/lib/db"

type GlobalWithDb = typeof globalThis & {
  __screenplayDbHandle?: { db: DB; ready: Promise<void> }
}

export interface SharedPgliteDb {
  /** The shared handle — the same one `@/lib/db` now resolves to. */
  db: DB
  /** Truncate every table back to a clean slate (call between tests). */
  reset: () => Promise<void>
  /** Close PGlite and detach it from the `@/lib/db` seam (call after all). */
  close: () => Promise<void>
}

/**
 * Boot ONE in-memory PGlite for a whole test file and point the `@/lib/db` seam
 * at it, so the app modules under test share this handle instead of each test
 * re-booting a fresh WASM Postgres.
 *
 * The db seam resolves its handle lazily off `globalThis` on first use (see
 * `lib/db/index.ts`), so pre-seeding that slot here means imported app code
 * queries this shared PGlite and never opens its own — no `SCREENPLAY_DB` /
 * `PGLITE_DATA_DIR` env stubbing needed either.
 *
 * `reset()` truncates every table between tests: the cheap equivalent of the
 * old per-test reboot, restoring a clean slate in milliseconds rather than
 * paying the ~2s migration boot each time. Wire it up as:
 *
 * ```ts
 * let harness: SharedPgliteDb
 * beforeAll(async () => { harness = await setupSharedPgliteDb() })
 * afterAll(() => harness.close())
 * beforeEach(() => harness.reset())
 * ```
 */
export async function setupSharedPgliteDb(): Promise<SharedPgliteDb> {
  const handle = createPgliteDb("memory://")
  await handle.ready

  const globalForDb = globalThis as GlobalWithDb
  globalForDb.__screenplayDbHandle = { db: handle.db, ready: Promise.resolve() }

  // Collect the migration set's tables once. `__drizzle_migrations` is left
  // alone so the schema stays migrated across resets; everything else is data
  // to clear between tests.
  // `DB` types `execute` off the abstract query-result HKT, so the row shape
  // isn't inferable here — assert the one column we select.
  const tableRows = (await handle.db.execute(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '__drizzle_migrations'`
  )) as unknown as { rows: Array<{ tablename: string }> }
  const tables = tableRows.rows.map((r) => r.tablename)

  // One statement, RESTART IDENTITY CASCADE so FK'd children go too and any
  // sequences reset — a full clean slate matching a fresh boot.
  const truncate = sql.raw(
    `TRUNCATE TABLE ${tables
      .map((t) => `"${t}"`)
      .join(", ")} RESTART IDENTITY CASCADE`
  )

  return {
    db: handle.db,
    async reset() {
      if (tables.length === 0) return
      await handle.db.execute(truncate)
    },
    async close() {
      delete globalForDb.__screenplayDbHandle
      await handle.close()
    },
  }
}
