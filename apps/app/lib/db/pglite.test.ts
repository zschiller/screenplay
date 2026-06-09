import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { and, eq, sql } from "drizzle-orm"
import { afterEach, describe, expect, it } from "vitest"

import { createPgliteDb } from "./pglite"
import {
  agentChat,
  agentMessage,
  agentPendingToolCall,
  agentRun,
  kvStore,
  room,
  terminalTab,
  user,
} from "./schema"
import type { ModelMessage } from "ai"

// Each test that needs durability across reopens gets its own temp data dir;
// we clean them up afterward.
const tempDirs: string[] = []
async function freshDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pglite-test-"))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))
  )
})

// Seed the minimum FK chain so the surviving tables can be exercised.
async function seedUser(db: Awaited<ReturnType<typeof createPgliteDb>>["db"]) {
  await db.insert(user).values({
    id: "u1",
    name: "Solo Dev",
    email: "solo@example.com",
  })
}

describe("createPgliteDb", () => {
  it("runs migrations on boot so the surviving tables exist", async () => {
    const { db, ready } = createPgliteDb("memory://")
    await ready

    // A query against a migrated table proves the schema is present.
    const rows = await db.select().from(user)
    expect(rows).toEqual([])
  })

  it("round-trips every surviving table, including the agentMessage jsonb payload", async () => {
    const { db, ready } = createPgliteDb("memory://")
    await ready

    await seedUser(db)
    await db
      .insert(room)
      .values({ id: "r1", name: "Canvas", ownerId: "u1" })
    await db.insert(agentChat).values({
      id: "c1",
      roomId: "r1",
      sandboxName: "sb1",
      model: "claude",
      systemPrompt: "be helpful",
    })
    await db.insert(agentRun).values({ id: "run1", chatId: "c1" })

    // The jsonb payload: a structured ACP/AI-SDK message. The whole point is
    // that nested JSON survives the embedded-Postgres round-trip byte-for-byte.
    const message: ModelMessage = {
      role: "assistant",
      content: [{ type: "text", text: "hello jsonb ✓" }],
    }
    await db.insert(agentMessage).values({
      id: "m1",
      chatId: "c1",
      role: "assistant",
      message,
    })
    await db.insert(agentPendingToolCall).values({
      id: "tc1",
      runId: "run1",
      chatId: "c1",
      toolName: "submit_plan",
      input: { plan: "do the thing", steps: [1, 2, 3] },
    })
    await db.insert(terminalTab).values({
      id: "tab1",
      userId: "u1",
      roomId: "r1",
      branch: "main",
      label: "shell",
    })
    await db
      .insert(kvStore)
      .values({ key: "k1", value: { nested: { a: 1 }, list: ["x"] } })

    const [msgRow] = await db
      .select()
      .from(agentMessage)
      .where(eq(agentMessage.id, "m1"))
    expect(msgRow?.message).toEqual(message)

    const [pending] = await db
      .select()
      .from(agentPendingToolCall)
      .where(eq(agentPendingToolCall.id, "tc1"))
    expect(pending?.input).toEqual({ plan: "do the thing", steps: [1, 2, 3] })
    expect(pending?.status).toBe("pending")
    // `created_at` defaults to `now()` — proving that default expression runs
    // identically under PGlite.
    expect(pending?.createdAt).toBeInstanceOf(Date)

    const [tab] = await db.select().from(terminalTab)
    expect(tab?.label).toBe("shell")

    const [kv] = await db.select().from(kvStore).where(eq(kvStore.key, "k1"))
    expect(kv?.value).toEqual({ nested: { a: 1 }, list: ["x"] })
  })

  it("preserves the jsonb ->> operator under PGlite", async () => {
    const { db, ready } = createPgliteDb("memory://")
    await ready

    // Mirrors the kv lock query: a `->>` extraction — plain Postgres, identical
    // under PGlite (the #406 spike called this operator out specifically).
    await db
      .insert(kvStore)
      .values({ key: "lock", value: { lockToken: "tok-123" } })

    const [hit] = await db
      .select()
      .from(kvStore)
      .where(
        and(
          eq(kvStore.key, "lock"),
          sql`${kvStore.value}->>'lockToken' = ${"tok-123"}`
        )
      )
    expect(hit?.key).toBe("lock")
  })

  it("rolls back an interactive transaction atomically (the batch→transaction swap)", async () => {
    const { db, ready } = createPgliteDb("memory://")
    await ready

    await seedUser(db)
    await db.insert(room).values({ id: "r1", name: "Canvas", ownerId: "u1" })
    await db.insert(agentChat).values({
      id: "c1",
      roomId: "r1",
      sandboxName: "sb1",
      model: "claude",
      systemPrompt: "be helpful",
    })
    await db.insert(agentRun).values({ id: "run1", chatId: "c1" })

    // An update followed by a duplicate-PK insert inside one transaction: the
    // insert throws, and the preceding update must roll back with it — exactly
    // the all-or-nothing guarantee pauseForPlan/resolvePlan rely on.
    await db.insert(agentRun).values({ id: "dup", chatId: "c1" })
    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(agentRun)
          .set({ status: "paused_for_plan" })
          .where(eq(agentRun.id, "run1"))
        // Collides with the existing "dup" primary key → aborts the txn.
        await tx.insert(agentRun).values({ id: "dup", chatId: "c1" })
      })
    ).rejects.toThrow()

    const [row] = await db
      .select()
      .from(agentRun)
      .where(eq(agentRun.id, "run1"))
    // The update was rolled back: status is still the default "running".
    expect(row?.status).toBe("running")
  })

  it("re-running migrations on the same data dir is idempotent and durable", async () => {
    const dataDir = await freshDataDir()

    const first = createPgliteDb(dataDir)
    await first.ready
    await seedUser(first.db)
    // Release the data dir before reopening it with a second handle.
    await first.close()

    // Boot again on the same dir: migrations re-run as a no-op, the schema is
    // stable, and the previously written row is still there.
    const second = createPgliteDb(dataDir)
    await second.ready
    const rows = await second.db.select().from(user)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.email).toBe("solo@example.com")
    await second.close()
  })
})
