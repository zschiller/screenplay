import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { createPgliteDb, type PgliteHandle } from "./pglite"
import {
  account,
  comment,
  roomMember,
  session,
  thread,
  threadRead,
  user,
  verification,
} from "./schema"

// The desktop build boots PGlite against the `drizzle/local` migration set,
// which drizzle-kit generates from `schema-core` and `schema-comments`. This
// pins the subtractive half of issue #417: the multi-user surface — GitHub
// OAuth (session/account/verification) and room_member sharing — must not exist
// in the local database, while the surviving tables, comment threads included
// (the host and their viewers comment, #1934), still do.
describe("local PGlite schema", () => {
  // Both assertions only read the migrated schema (no writes), so boot one
  // in-memory PGlite for the file instead of paying a fresh ~2s WASM boot per
  // test. `beforeAll` gets headroom so the one-time boot stays reliable under
  // full-suite CPU contention.
  let handle: PgliteHandle
  let db: PgliteHandle["db"]
  beforeAll(async () => {
    handle = createPgliteDb("memory://")
    await handle.ready
    db = handle.db
  }, 30000)
  afterAll(() => handle.close())

  it("creates the surviving tables", async () => {
    // A query against a migrated table resolves (empty result, no throw).
    for (const table of [user, thread, comment, threadRead]) {
      await expect(db.select().from(table)).resolves.toEqual([])
    }
  })

  it("excludes every multi-user table", async () => {
    const excluded = [
      ["session", session],
      ["account", account],
      ["verification", verification],
      ["room_member", roomMember],
    ] as const

    for (const [name, table] of excluded) {
      // The relation does not exist in the local DB, so the query throws.
      await expect(
        db.select().from(table),
        `expected ${name} to be absent from the local schema`
      ).rejects.toThrow()
    }
  })
})
