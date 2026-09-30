import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"

import { setupSharedPgliteDb, type SharedPgliteDb } from "../../test/pglite"

// The Steer inbox (#1190) against an in-memory PGlite, the same plain Postgres
// the desktop build runs. It pins what the handoff between the send and the
// Engine depends on: Steers come out oldest first, each leaves the inbox
// exactly once, and a run that stopped takes nothing.
describe("Steer inbox", () => {
  let harness: SharedPgliteDb
  beforeAll(async () => {
    harness = await setupSharedPgliteDb()
  }, 30000)
  afterAll(() => harness.close())
  beforeEach(() => harness.reset())

  async function seedRun(status: "running" | "aborted" = "running") {
    const { db, dbReady, schema } = await import("@/lib/db")
    await dbReady
    await db.insert(schema.agentChat).values({
      id: "chat_1",
      roomId: "room_1",
      sandboxName: "",
      model: "m",
      systemPrompt: "s",
    })
    await db
      .insert(schema.agentRun)
      .values({ id: "run_1", chatId: "chat_1", status })
    const { createSteerInbox } = await import("./steer-inbox")
    return { inbox: createSteerInbox(db), db, schema }
  }

  const add = (
    inbox: Awaited<ReturnType<typeof seedRun>>["inbox"],
    message: string
  ) => inbox.add({ runId: "run_1", chatId: "chat_1", message, userId: "u_1" })

  it("takes every pending Steer once, oldest first", async () => {
    const { inbox } = await seedRun()
    await add(inbox, "first")
    await add(inbox, "second")

    expect((await inbox.take("run_1")).map((s) => s.message)).toEqual([
      "first",
      "second",
    ])
    expect(await inbox.take("run_1")).toEqual([])
    // Taken Steers aren't leftovers.
    expect(await inbox.drain("run_1")).toEqual([])
  })

  it("takes nothing once the run has stopped, leaving it for the sender", async () => {
    const { inbox, db, schema } = await seedRun()
    await add(inbox, "actually, wait")
    await db
      .update(schema.agentRun)
      .set({ status: "aborted" })
      .where(eq(schema.agentRun.id, "run_1"))

    expect(await inbox.take("run_1")).toEqual([])
    expect(await inbox.drain("run_1")).toMatchObject([
      { message: "actually, wait", userId: "u_1" },
    ])
    expect(await inbox.drain("run_1")).toEqual([])
  })

  it("makes a released Steer pending again, in its place", async () => {
    const { inbox } = await seedRun()
    await add(inbox, "first")
    await add(inbox, "second")
    const taken = await inbox.take("run_1")
    await inbox.release(taken.map((s) => s.id))

    expect((await inbox.take("run_1")).map((s) => s.message)).toEqual([
      "first",
      "second",
    ])
    await inbox.release([taken[1]!.id])
    expect(await inbox.drain("run_1")).toMatchObject([{ message: "second" }])
  })

  it("gives a Steer back once, and not after it was taken", async () => {
    const { inbox } = await seedRun()
    const kept = await add(inbox, "kept")
    const taken = await add(inbox, "taken")
    expect(await inbox.reclaim(kept.id)).toBe(true)
    expect(await inbox.reclaim(kept.id)).toBe(false)

    await inbox.take("run_1")
    expect(await inbox.reclaim(taken.id)).toBe(false)
  })
})
