import { describe, expect, it } from "vitest"

import { createPgliteDb } from "./pglite"
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
// which drizzle-kit generates from `schema-core` alone. This pins the
// subtractive half of issue #417: the multi-user surface — GitHub OAuth
// (session/account/verification), room_member sharing, and
// thread/comment/thread_read — must not exist in the local database, while the
// surviving tables still do.
describe("local PGlite schema", () => {
  it("creates the surviving tables", async () => {
    const { db, ready } = createPgliteDb("memory://")
    await ready
    // A query against a migrated core table resolves (empty result, no throw).
    await expect(db.select().from(user)).resolves.toEqual([])
  })

  it("excludes every multi-user table", async () => {
    const { db, ready } = createPgliteDb("memory://")
    await ready

    const excluded = [
      ["session", session],
      ["account", account],
      ["verification", verification],
      ["room_member", roomMember],
      ["thread", thread],
      ["comment", comment],
      ["thread_read", threadRead],
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
