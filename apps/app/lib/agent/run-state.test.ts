import { describe, expect, it, vi } from "vitest"

// run-state.ts binds a default machine to the live Drizzle handle at import
// time, which would demand a real DATABASE_URL. Stub it: every test here drives
// the machine through an injected fake repo, so this handle is never touched.
vi.mock("@/lib/db", () => ({ db: {} }))

import {
  createRunState,
  type RunStateRepo,
  type RunStatus,
} from "@/lib/agent/run-state"

/**
 * In-memory stand-in for the run table. It is a real (if tiny) implementation
 * of the persistence port, not a call-spy — tests assert on the *state* it
 * holds after an operation, so they describe what the machine does, not how it
 * talks to Drizzle. Swapping the Drizzle-backed repo for this one is the whole
 * point of the seam.
 */
function fakeRepo() {
  type Row = { chatId: string; status: RunStatus; endedAt: Date | null }
  type PendingRow = {
    runId: string
    chatId: string
    toolName: string
    input: Record<string, unknown>
    status: "pending" | "approved" | "rejected"
    feedback: string | null
  }
  const runs = new Map<string, Row>()
  const pendings = new Map<string, PendingRow>()
  let seq = 0

  const repo: RunStateRepo = {
    async loadStatus(runId) {
      return runs.get(runId)?.status ?? null
    },
    async applyTransition(runId, to, endedAt) {
      const row = runs.get(runId)
      if (!row) return
      row.status = to
      if (endedAt) row.endedAt = endedAt
    },
    async supersedeActiveRuns(chatId) {
      for (const row of runs.values()) {
        if (
          row.chatId === chatId &&
          (row.status === "running" || row.status === "paused_for_plan")
        ) {
          row.status = "superseded"
          row.endedAt = new Date()
        }
      }
    },
    async insertRunning(chatId) {
      const id = `run_${++seq}`
      runs.set(id, { chatId, status: "running", endedAt: null })
      return id
    },
    async pauseForPlan(runId, planCall) {
      // A real INSERT would reject a duplicate primary key (the tool-call id);
      // throwing *before* either write mutates anything models the batch
      // rolling back as a unit — neither the run status nor the pending row
      // lands.
      if (pendings.has(planCall.toolCallId)) {
        throw new Error(
          `pending tool call ${planCall.toolCallId} already exists`
        )
      }
      const run = runs.get(runId)
      if (!run) throw new Error(`unknown run ${runId}`)
      run.status = "paused_for_plan"
      pendings.set(planCall.toolCallId, {
        runId,
        chatId: planCall.chatId,
        toolName: planCall.toolName,
        input: planCall.input,
        status: "pending",
        feedback: null,
      })
    },
    async resolvePlan(planId, resolution) {
      const pending = pendings.get(planId)
      if (!pending || pending.status !== "pending") return null
      const run = runs.get(pending.runId)
      // A vanished run (cascade delete, FK violation) aborts the whole batch;
      // throwing here before any write models that rollback — the pending row
      // stays `pending`.
      if (!run) throw new Error(`run ${pending.runId} not found`)
      pending.status = resolution.approved ? "approved" : "rejected"
      pending.feedback = resolution.feedback ?? null
      run.status = "superseded"
      run.endedAt = new Date()
      return { runId: pending.runId }
    },
  }

  return {
    repo,
    /** Seed a run in a given state, returning its id. */
    seed(
      status: RunStatus,
      opts: { chatId?: string; endedAt?: Date | null } = {}
    ) {
      const id = `run_${++seq}`
      runs.set(id, {
        chatId: opts.chatId ?? "chat_1",
        status,
        endedAt: opts.endedAt ?? null,
      })
      return id
    },
    /** Seed a pending tool-call row directly, returning its id. */
    seedPending(
      id: string,
      opts: {
        runId: string
        chatId?: string
        status?: "pending" | "approved" | "rejected"
      }
    ) {
      pendings.set(id, {
        runId: opts.runId,
        chatId: opts.chatId ?? "chat_1",
        toolName: "submit_plan",
        input: {},
        status: opts.status ?? "pending",
        feedback: null,
      })
      return id
    },
    row: (id: string) => runs.get(id),
    pending: (id: string) => pendings.get(id),
    pendingCount: () => pendings.size,
  }
}

describe("transition", () => {
  it("moves a running run to a legal next state", async () => {
    const store = fakeRepo()
    const id = store.seed("running")
    const { transition } = createRunState(store.repo)

    await transition(id, "completed")

    expect(store.row(id)?.status).toBe("completed")
  })

  it("stamps endedAt when reaching a terminal state", async () => {
    const store = fakeRepo()
    const id = store.seed("running")
    const { transition } = createRunState(store.repo)

    await transition(id, "failed")

    expect(store.row(id)?.endedAt).toBeInstanceOf(Date)
  })

  it("does not stamp endedAt on a non-terminal transition", async () => {
    const store = fakeRepo()
    const id = store.seed("running")
    const { transition } = createRunState(store.repo)

    await transition(id, "paused_for_plan")

    expect(store.row(id)?.status).toBe("paused_for_plan")
    expect(store.row(id)?.endedAt).toBeNull()
  })

  it("rejects an illegal edge without changing the run", async () => {
    const store = fakeRepo()
    const id = store.seed("paused_for_plan")
    const { transition } = createRunState(store.repo)

    // paused_for_plan may only go to aborted | superseded — completing
    // straight from a pending plan is not a legal edge.
    await expect(transition(id, "completed")).rejects.toThrow(/illegal/i)
    expect(store.row(id)?.status).toBe("paused_for_plan")
  })

  it("throws when the run does not exist", async () => {
    const store = fakeRepo()
    const { transition } = createRunState(store.repo)

    await expect(transition("nope", "completed")).rejects.toThrow(/unknown/i)
  })

  it("is a no-op on an already-terminal run (late /stop must not clobber)", async () => {
    const store = fakeRepo()
    const endedAt = new Date("2026-01-01T00:00:00Z")
    const id = store.seed("completed", { endedAt })
    const { transition } = createRunState(store.repo)

    // A /stop landing after the run already finished must not rewrite the
    // recorded outcome — and must not throw, since it is a benign race.
    await expect(transition(id, "aborted")).resolves.toBeUndefined()
    expect(store.row(id)?.status).toBe("completed")
    expect(store.row(id)?.endedAt).toBe(endedAt)
  })
})

describe("transition edge table", () => {
  const ALL: RunStatus[] = [
    "running",
    "paused_for_plan",
    "completed",
    "failed",
    "aborted",
    "superseded",
  ]
  // The contract from the issue, restated here so the test pins the spec rather
  // than echoing the module's own table.
  const legal: Record<RunStatus, RunStatus[]> = {
    running: [
      "completed",
      "failed",
      "aborted",
      "superseded",
      "paused_for_plan",
    ],
    paused_for_plan: ["aborted", "superseded"],
    completed: [],
    failed: [],
    aborted: [],
    superseded: [],
  }

  for (const from of ALL) {
    for (const to of ALL) {
      const isLegal = legal[from].includes(to)
      const isTerminalSource = legal[from].length === 0
      it(`${from} → ${to} is ${isLegal ? "legal" : isTerminalSource ? "a no-op" : "illegal"}`, async () => {
        const store = fakeRepo()
        const id = store.seed(from)
        const { transition } = createRunState(store.repo)

        if (isLegal) {
          await transition(id, to)
          expect(store.row(id)?.status).toBe(to)
        } else if (isTerminalSource) {
          // Terminal sources accept nothing and stay put, silently.
          await transition(id, to)
          expect(store.row(id)?.status).toBe(from)
        } else {
          await expect(transition(id, to)).rejects.toThrow(/illegal/i)
          expect(store.row(id)?.status).toBe(from)
        }
      })
    }
  }
})

describe("startRun", () => {
  it("returns a fresh running run for the chat", async () => {
    const store = fakeRepo()
    const { startRun } = createRunState(store.repo)

    const id = await startRun("chat_1")

    expect(store.row(id)?.status).toBe("running")
  })

  it("supersedes runs still active for the chat", async () => {
    const store = fakeRepo()
    const running = store.seed("running", { chatId: "chat_1" })
    const paused = store.seed("paused_for_plan", { chatId: "chat_1" })
    const { startRun } = createRunState(store.repo)

    await startRun("chat_1")

    expect(store.row(running)?.status).toBe("superseded")
    expect(store.row(paused)?.status).toBe("superseded")
  })

  it("leaves finished runs and other chats' runs alone", async () => {
    const store = fakeRepo()
    const done = store.seed("completed", { chatId: "chat_1" })
    const otherChat = store.seed("running", { chatId: "chat_2" })
    const { startRun } = createRunState(store.repo)

    await startRun("chat_1")

    expect(store.row(done)?.status).toBe("completed")
    expect(store.row(otherChat)?.status).toBe("running")
  })
})

describe("isRunActive", () => {
  it("is true only while the run is running", async () => {
    const store = fakeRepo()
    const { isRunActive } = createRunState(store.repo)

    expect(await isRunActive(store.seed("running"))).toBe(true)
    expect(await isRunActive(store.seed("paused_for_plan"))).toBe(false)
    expect(await isRunActive(store.seed("completed"))).toBe(false)
    expect(await isRunActive(store.seed("superseded"))).toBe(false)
    expect(await isRunActive("missing")).toBe(false)
  })
})

describe("pauseForPlan", () => {
  it("pauses the run and records its pending plan", async () => {
    const store = fakeRepo()
    const id = store.seed("running")
    const { pauseForPlan } = createRunState(store.repo)

    await pauseForPlan(id, {
      toolCallId: "call_1",
      chatId: "chat_1",
      toolName: "submit_plan",
      input: { plan: "do the thing" },
    })

    expect(store.row(id)?.status).toBe("paused_for_plan")
    expect(store.pending("call_1")?.status).toBe("pending")
    expect(store.pending("call_1")?.runId).toBe(id)
  })

  it("rolls back both writes when the pending insert fails (tables stay consistent)", async () => {
    const store = fakeRepo()
    const id = store.seed("running")
    // A pending row already owns this tool-call id; the insert inside
    // pauseForPlan collides with it. The whole transaction must roll back —
    // the run stays running and no second pending row appears.
    store.seedPending("call_dup", { runId: id })
    const { pauseForPlan } = createRunState(store.repo)

    await expect(
      pauseForPlan(id, {
        toolCallId: "call_dup",
        chatId: "chat_1",
        toolName: "submit_plan",
        input: {},
      })
    ).rejects.toThrow()

    expect(store.row(id)?.status).toBe("running")
    expect(store.pendingCount()).toBe(1)
  })

  it("throws when the run does not exist", async () => {
    const store = fakeRepo()
    const { pauseForPlan } = createRunState(store.repo)

    await expect(
      pauseForPlan("nope", {
        toolCallId: "call_x",
        chatId: "chat_1",
        toolName: "submit_plan",
        input: {},
      })
    ).rejects.toThrow(/unknown/i)
  })

  it("stands down on an already-terminal run without orphaning a pending row", async () => {
    const store = fakeRepo()
    // The run was superseded by a newer message while the model was still
    // emitting its plan; pausing now would orphan a pending row.
    const id = store.seed("superseded")
    const { pauseForPlan } = createRunState(store.repo)

    await pauseForPlan(id, {
      toolCallId: "call_late",
      chatId: "chat_1",
      toolName: "submit_plan",
      input: {},
    })

    expect(store.row(id)?.status).toBe("superseded")
    expect(store.pendingCount()).toBe(0)
  })
})

describe("resolvePlan", () => {
  it("approves the plan and supersedes its run, in one step", async () => {
    const store = fakeRepo()
    const runId = store.seed("paused_for_plan")
    store.seedPending("plan_1", { runId })
    const { resolvePlan } = createRunState(store.repo)

    const result = await resolvePlan("plan_1", { approved: true })

    expect(result).toEqual({ runId })
    expect(store.pending("plan_1")?.status).toBe("approved")
    expect(store.row(runId)?.status).toBe("superseded")
  })

  it("records a rejection with its feedback and supersedes the run", async () => {
    const store = fakeRepo()
    const runId = store.seed("paused_for_plan")
    store.seedPending("plan_2", { runId })
    const { resolvePlan } = createRunState(store.repo)

    await resolvePlan("plan_2", { approved: false, feedback: "try again" })

    expect(store.pending("plan_2")?.status).toBe("rejected")
    expect(store.pending("plan_2")?.feedback).toBe("try again")
    expect(store.row(runId)?.status).toBe("superseded")
  })

  it("is a no-op returning null when the plan is already resolved", async () => {
    const store = fakeRepo()
    const runId = store.seed("paused_for_plan")
    store.seedPending("plan_done", { runId, status: "approved" })
    const { resolvePlan } = createRunState(store.repo)

    expect(await resolvePlan("plan_done", { approved: false })).toBeNull()
    // The run was not touched — a second resolution can't supersede it again.
    expect(store.row(runId)?.status).toBe("paused_for_plan")
  })

  it("rolls back both writes when the run write fails (tables stay consistent)", async () => {
    const store = fakeRepo()
    // The pending row points at a run that no longer exists, so the run update
    // inside resolvePlan fails and the whole transaction rolls back — the
    // tool-call stays pending rather than being marked resolved on its own.
    store.seedPending("plan_orphan", { runId: "ghost_run" })
    const { resolvePlan } = createRunState(store.repo)

    await expect(
      resolvePlan("plan_orphan", { approved: true })
    ).rejects.toThrow()

    expect(store.pending("plan_orphan")?.status).toBe("pending")
  })
})

describe("approved/rejected plan vs aborted /stop", () => {
  it("records an approved plan's prior run as superseded, not aborted", async () => {
    const store = fakeRepo()
    const runId = store.seed("paused_for_plan")
    store.seedPending("plan_a", { runId })
    const { resolvePlan } = createRunState(store.repo)

    await resolvePlan("plan_a", { approved: true })

    expect(store.row(runId)?.status).toBe("superseded")
  })

  it("records a user /stop as aborted", async () => {
    const store = fakeRepo()
    const runId = store.seed("running")
    const { transition } = createRunState(store.repo)

    await transition(runId, "aborted")

    expect(store.row(runId)?.status).toBe("aborted")
  })
})
