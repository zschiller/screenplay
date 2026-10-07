import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { eq } from "drizzle-orm"

import { setupSharedPgliteDb, type SharedPgliteDb } from "@/test/pglite"

// The live run-state port against PGlite, through a handle that rejects
// `transaction()` as hosted neon-http does (#1899). `run-state.test.ts` covers
// the transition rules over an in-memory fake; this file proves the two atomic
// writes hold on a real database without a transaction.
describe("run-state persistence", () => {
  let harness: SharedPgliteDb
  beforeAll(async () => {
    harness = await setupSharedPgliteDb()
  }, 30000)
  afterAll(() => harness.close())
  beforeEach(() => harness.reset())

  async function seedRun(status: "running" | "paused_for_plan" = "running") {
    const { db, dbReady, schema } = await import("@/lib/db")
    await dbReady
    await db
      .insert(schema.user)
      .values({ id: "u1", name: "Solo", email: "solo@example.com" })
    await db
      .insert(schema.room)
      .values({ id: "r1", name: "Canvas", ownerId: "u1" })
    await db.insert(schema.agentChat).values({
      id: "c1",
      roomId: "r1",
      sandboxName: "sb1",
      model: "claude",
      systemPrompt: "be helpful",
    })
    await db
      .insert(schema.agentRun)
      .values({ id: "run1", chatId: "c1", status })
  }

  async function runRow() {
    const { db, schema } = await import("@/lib/db")
    const [row] = await db
      .select()
      .from(schema.agentRun)
      .where(eq(schema.agentRun.id, "run1"))
    return row
  }

  async function pendingRows() {
    const { db, schema } = await import("@/lib/db")
    return db.select().from(schema.agentPendingToolCall)
  }

  const plan = {
    toolCallId: "call_1",
    chatId: "c1",
    toolName: "submit_plan",
    input: { plan: "do the thing" },
  }

  it("pauses a run and records its pending plan", async () => {
    await seedRun()
    const { pauseForPlan } = await import("./run-state")

    await pauseForPlan("run1", plan)

    expect((await runRow())?.status).toBe("paused_for_plan")
    expect(await pendingRows()).toMatchObject([
      { id: "call_1", runId: "run1", status: "pending" },
    ])
  })

  it("leaves the run running when the pending insert fails", async () => {
    await seedRun()
    const { db, schema } = await import("@/lib/db")
    // A pending row already owns this tool-call id, so the insert collides.
    await db.insert(schema.agentPendingToolCall).values({
      id: "call_1",
      runId: "run1",
      chatId: "c1",
      toolName: "submit_plan",
      input: {},
    })
    const { pauseForPlan } = await import("./run-state")

    await expect(pauseForPlan("run1", plan)).rejects.toThrow()

    expect((await runRow())?.status).toBe("running")
    expect(await pendingRows()).toHaveLength(1)
  })

  it("resolves a plan and supersedes its run", async () => {
    await seedRun()
    const { pauseForPlan, resolvePlan } = await import("./run-state")
    await pauseForPlan("run1", plan)

    expect(
      await resolvePlan("call_1", { approved: false, feedback: "try again" })
    ).toEqual({ runId: "run1" })

    const run = await runRow()
    expect(run?.status).toBe("superseded")
    expect(run?.endedAt).toBeInstanceOf(Date)
    expect(await pendingRows()).toMatchObject([
      { id: "call_1", status: "rejected", feedback: "try again" },
    ])
  })

  it("does not clobber a run a /stop already aborted", async () => {
    await seedRun()
    const { pauseForPlan, resolvePlan, transition } =
      await import("./run-state")
    await pauseForPlan("run1", plan)
    await transition("run1", "aborted")

    await resolvePlan("call_1", { approved: true })

    expect((await runRow())?.status).toBe("aborted")
    expect(await pendingRows()).toMatchObject([{ status: "approved" }])
  })
})
