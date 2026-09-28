import { describe, expect, it, vi } from "vitest"

// The in-process engine binds to the model providers at import time; every test
// injects a fake stream driver, so stub the provider resolution that would
// otherwise demand real API keys (mirrors contract.test.ts).
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
}))
// `run-state` binds to the live Drizzle handle at import time; this drives a
// real `createRunState` over an in-memory repo, so stub the db boundary that
// would otherwise demand a real DATABASE_URL (mirrors consumer.test.ts).
vi.mock("@/lib/db", () => ({ db: {} }))

import { AcpUpdateConsumer, type AcpConsumerPorts } from "./consumer"
import { driveEngineTurn } from "./live-turn"
import {
  launchTurn,
  STOPPED_RUN_STATUS,
  stopTurn,
  type PreparedTurn,
  type TurnLaunchDeps,
  type TurnRequest,
} from "../turn-launch"
import { InProcessEngine, type StreamDriver } from "./in-process-engine"
import {
  createRunState,
  type PendingPlanCall,
  type RunStateRepo,
  type RunStatus,
} from "../run-state"
import { renderHistory, type HistoryEntry } from "@/lib/agent/history-render"
import { wireToContentBlocks } from "./markers"
import { planResolutionText } from "./resolution"
import type { AcpMessageRecord, AcpToolCallRecord } from "./record"
import { chatStore, type ChatBroadcastEvent } from "@/lib/chat-store"
import type { AgentMessage } from "@/lib/agent/types"

/**
 * The keystone end-to-end live-route seam test (ADR 0006, issue #397). It drives
 * what `/api/agent/stream` drives — {@link launchTurn} (Turn Launch, #907), then
 * `Engine.run → AcpUpdateConsumer` through {@link driveEngineTurn}, with the
 * abort watchdog at that boundary — over an **injected fake `StreamDriver`**,
 * an **in-memory run-state**, and **in-memory ACP ports**. It asserts the whole
 * cutover in one place: ACP-native records persisted (no `ModelMessage` rows),
 * ACP-shaped broadcasts (no `chat-stream`), the correct terminal run-state, the
 * plan-pause and `/stop` mappings, and that the persisted ACP-native log
 * rebuilds the *same* conversation the live broadcast produced.
 */

const ROOM_ID = "room_1"
const CHAT_ID = "chat_1"
const RUN_ID = "run_1"

/**
 * The live boundary, in memory: the run-state machine's genuine guards over an
 * in-memory `agent_run` row, the ACP-native durable log (records + plan rows),
 * and the Room broadcast captured as an ordered envelope log — exactly the
 * shape `broadcastChatEventViaDoc` appends and every browser subscriber renders.
 */
function liveHarness() {
  const records: AcpMessageRecord[] = []
  const toolCalls = new Map<string, AcpToolCallRecord>()
  const planRows = new Map<
    string,
    { plan: string; status: "pending" | "approved" | "rejected" }
  >()
  // Where each plan gate falls in the durable log (its row's `createdAt`), so a
  // reload interleaves the card the way the history route does.
  const planAt = new Map<string, number>()
  const broadcasts: ChatBroadcastEvent[] = []
  let n = 0
  const mintId = () => `evt_${++n}`

  const rows = new Map<string, RunStatus>()
  const repo: RunStateRepo = {
    async loadStatus(id) {
      return rows.get(id) ?? null
    },
    async applyTransition(id, to) {
      rows.set(id, to)
    },
    async supersedeActiveRuns() {
      for (const [id, status] of rows) {
        if (status === "running" || status === "paused_for_plan") {
          rows.set(id, "superseded")
        }
      }
    },
    async insertRunning() {
      const id = `run_${rows.size + 1}`
      rows.set(id, "running")
      return id
    },
    async pauseForPlan(id: string, planCall: PendingPlanCall) {
      rows.set(id, "paused_for_plan")
      planRows.set(planCall.toolCallId, {
        plan: String((planCall.input as { plan?: unknown }).plan ?? ""),
        status: "pending",
      })
      planAt.set(planCall.toolCallId, records.length)
      planRuns.set(planCall.toolCallId, id)
    },
    async resolvePlan(planId, resolution) {
      const row = planRows.get(planId)
      if (row?.status !== "pending") return null
      row.status = resolution.approved ? "approved" : "rejected"
      const runId = planRuns.get(planId)!
      rows.set(runId, "superseded")
      return { runId }
    },
  }
  const planRuns = new Map<string, string>()
  const runState = createRunState(repo)

  const portsFor = (runId: string): AcpConsumerPorts => ({
    async broadcastUpdate(update) {
      broadcasts.push({
        type: "chat-acp-update",
        chatId: CHAT_ID,
        id: mintId(),
        update,
      })
    },
    async broadcastError(message) {
      broadcasts.push({
        type: "chat-control",
        chatId: CHAT_ID,
        id: mintId(),
        control: { kind: "error", message },
      })
    },
    async broadcastEnd() {
      broadcasts.push({
        type: "chat-stream-end",
        chatId: CHAT_ID,
        id: mintId(),
      })
    },
    async appendRecord(record) {
      records.push(record)
    },
    async upsertToolCall(record) {
      toolCalls.set(record.toolCallId, record)
    },
    async transition(to) {
      await runState.transition(runId, to)
    },
    async broadcastPermissionRequest(request) {
      broadcasts.push({
        type: "chat-acp-permission",
        chatId: CHAT_ID,
        id: mintId(),
        request,
      })
    },
    async pauseForPlan(planCall) {
      await runState.pauseForPlan(runId, { ...planCall, chatId: CHAT_ID })
    },
  })

  /**
   * Turn Launch over the in-memory boundary. The Engine turn is held back until
   * the test calls `afterResponse()`, the way `after()` holds it until the HTTP
   * response has gone out.
   */
  const launch = async (
    text: string,
    driver: StreamDriver,
    prepared: Partial<PreparedTurn> = {},
    request: Partial<TurnRequest> = {}
  ) => {
    const afterResponse: Array<() => Promise<void>> = []
    const deps: TurnLaunchDeps = {
      resolveEngine: async () => new InProcessEngine(driver),
      async findPendingPlan() {
        const pending = [...planRows].find(([, r]) => r.status === "pending")
        return pending ? { id: pending[0] } : null
      },
      resolvePlan: (planId, resolution) =>
        runState.resolvePlan(planId, resolution),
      async persistUserTurn(_chatId, userText) {
        records.push({ role: "user", content: wireToContentBlocks(userText) })
      },
      startRun: (chatId) => runState.startRun(chatId),
      async broadcastStreamStart() {
        broadcasts.push({
          type: "chat-stream-start",
          chatId: CHAT_ID,
          id: mintId(),
        })
      },
      broadcastUpdate: (_roomId, _chatId, update) =>
        portsFor(RUN_ID).broadcastUpdate(update),
      async broadcastControl(_roomId, _chatId, control) {
        broadcasts.push({
          type: "chat-control",
          chatId: CHAT_ID,
          id: mintId(),
          control,
        })
      },
      async renameBranch() {},
      async queueCommentRequest() {},
      async startCommentRequest() {},
      async settleCommentRequest() {},
      driveTurn: (turn) =>
        driveEngineTurn(
          turn.engine,
          {
            chatId: turn.chatId,
            runId: turn.runId,
            roomId: turn.roomId,
            systemPrompt: turn.systemPrompt,
            model: turn.model,
            history: records.slice(),
          },
          new AcpUpdateConsumer(portsFor(turn.runId)),
          { isRunActive: (id) => runState.isRunActive(id) }
        ),
      runAfterResponse: (task) => {
        afterResponse.push(task)
      },
    }
    const result = await launchTurn(
      deps,
      { roomId: ROOM_ID, chatId: CHAT_ID, message: text, ...request },
      {
        prepare: async () => ({
          systemPrompt: "sys",
          model: "anthropic:test",
          tools: {},
          userText: text,
          ...prepared,
        }),
      }
    )
    return {
      result,
      afterResponse: async () => {
        for (const task of afterResponse) await task()
      },
    }
  }

  /** What `/api/agent/stop` does, over the same in-memory boundary. */
  const stop = () =>
    stopTurn(
      {
        async findActiveRun() {
          for (const [id, status] of rows) {
            if (status === "running" || status === "paused_for_plan")
              return { id }
          }
          return null
        },
        transition: (id, to) => runState.transition(id, to),
        async broadcastControl(_roomId, _chatId, control) {
          broadcasts.push({
            type: "chat-control",
            chatId: CHAT_ID,
            id: mintId(),
            control,
          })
        },
        broadcastStreamEnd: () => portsFor(RUN_ID).broadcastEnd(),
      },
      { roomId: ROOM_ID, chatId: CHAT_ID }
    )

  /** Launch a turn and drive it to the end, as the request plus `after()` do. */
  const run = async (
    text: string,
    driver: StreamDriver,
    request: Partial<TurnRequest> = {}
  ) => {
    const { result, afterResponse } = await launch(text, driver, {}, request)
    await afterResponse()
    return result
  }

  return {
    records,
    toolCalls,
    planRows,
    planAt,
    broadcasts,
    rows,
    runState,
    launch,
    run,
    stop,
  }
}

/** Replay the captured Room broadcast into a fresh chat-store — one browser. */
function liveMessages(broadcasts: ChatBroadcastEvent[]): AgentMessage[] {
  const chatId = `live_${Math.random().toString(36).slice(2)}`
  for (const e of broadcasts) {
    chatStore.handleBroadcastEvent({ ...e, chatId })
  }
  const messages = chatStore.getSnapshot(chatId).messages
  chatStore.cleanup(chatId)
  return messages
}

/** Rebuild the reload view from the persisted ACP-native log (history route). */
function reloadMessages(
  records: AcpMessageRecord[],
  planRows: Map<
    string,
    { plan: string; status: "pending" | "approved" | "rejected" }
  >,
  planAt: Map<string, number> = new Map(),
  runs: Map<string, RunStatus> = new Map()
): AgentMessage[] {
  const entries: HistoryEntry[] = []
  const plansAt = (i: number) => {
    for (const [planId, row] of planRows) {
      if ((planAt.get(planId) ?? records.length) === i) {
        entries.push({
          kind: "plan",
          planId,
          plan: row.plan,
          status: row.status,
        })
      }
    }
  }
  records.forEach((record, i) => {
    plansAt(i)
    entries.push({ kind: "record", record })
  })
  plansAt(records.length)
  // The history route's stopped-run query: each run with Turn Launch's stopped
  // status ends in a marker (placed at its `endedAt`, after these records).
  for (const status of runs.values()) {
    if (status === STOPPED_RUN_STATUS) entries.push({ kind: "stopped" })
  }
  return renderHistory(entries)
}

/** A turn that narrates, then submits a plan and pauses on it. */
const planDriver: StreamDriver = (config) => ({
  consumeStream: async () => {
    await config.onChunk?.({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chunk: { type: "text-delta", id: "t1", text: "My plan:" } as any,
    })
    await config.onChunk?.({
      chunk: {
        type: "tool-call",
        toolCallId: "toolu_plan_1",
        toolName: "submit_plan",
        input: { plan: "1. ship it" },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await config.onFinish?.({ finishReason: "tool-calls" } as any)
  },
})

/** A turn that replies with one text block and completes. */
function replyDriver(text: string): StreamDriver {
  return (config) => ({
    consumeStream: async () => {
      await config.onChunk?.({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        chunk: { type: "text-delta", id: "t2", text } as any,
      })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await config.onFinish?.({ finishReason: "stop" } as any)
    },
  })
}

describe("keystone — live-route seam (stream/plan → Engine.run → AcpUpdateConsumer)", () => {
  it("a plain text turn: ACP-native records, ACP-shaped broadcasts, completion, and a reload that rebuilds the live view", async () => {
    const h = liveHarness()

    const driver: StreamDriver = (config) => ({
      consumeStream: async () => {
        await config.onChunk?.({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          chunk: { type: "text-delta", id: "t1", text: "Hel" } as any,
        })
        await config.onChunk?.({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          chunk: { type: "text-delta", id: "t1", text: "lo" } as any,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await config.onFinish?.({ finishReason: "stop" } as any)
      },
    })
    await h.run("hi", driver)

    // Persistence is ACP-native: the user turn and the agent reply, no
    // `ModelMessage` rows (every record carries an ACP role).
    expect(h.records).toEqual<AcpMessageRecord[]>([
      { role: "user", content: [{ type: "text", text: "hi" }] },
      { role: "agent", content: [{ type: "text", text: "Hello" }] },
    ])
    for (const r of h.records) {
      expect(["user", "agent", "thought", "tool_call"]).toContain(r.role)
    }

    // Broadcasts are ACP-shaped — `chat-acp-update`s + the stream-end signal,
    // never the retired `chat-stream` channel.
    expect(h.broadcasts.map((e) => e.type)).toEqual([
      "chat-stream-start",
      "chat-acp-update", // user echo
      "chat-acp-update", // "Hel"
      "chat-acp-update", // "lo"
      "chat-stream-end",
    ])
    expect(h.broadcasts.some((e) => (e.type as string) === "chat-stream")).toBe(
      false
    )

    // Terminal run-state is a clean completion.
    expect(h.rows.get(RUN_ID)).toBe("completed")

    // The reload (history route) rebuilds the same conversation the live
    // broadcast produced — the keystone round-trip.
    const live = liveMessages(h.broadcasts)
    const reload = reloadMessages(h.records, h.planRows)
    expect(live).toEqual<AgentMessage[]>([
      { role: "user", content: "hi" },
      { role: "assistant", content: "Hello" },
    ])
    expect(reload).toEqual(live)
  })

  it("plan-pause: submit_plan maps to an ACP permission request + pause, not a completion", async () => {
    const h = liveHarness()

    const driver: StreamDriver = (config) => ({
      consumeStream: async () => {
        await config.onChunk?.({
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          chunk: { type: "text-delta", id: "t1", text: "My plan:" } as any,
        })
        await config.onChunk?.({
          chunk: {
            type: "tool-call",
            toolCallId: "toolu_plan_1",
            toolName: "submit_plan",
            input: { plan: "1. ship it" },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        })
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await config.onFinish?.({ finishReason: "tool-calls" } as any)
      },
    })
    await h.run("plan it", driver)

    // The gate is an ACP permission request, broadcast on its own envelope.
    const permission = h.broadcasts.find(
      (e) => e.type === "chat-acp-permission"
    )
    expect(permission).toBeDefined()

    // The run paused for the plan (recorded the pending row), not completed.
    expect(h.rows.get(RUN_ID)).toBe("paused_for_plan")
    expect(h.planRows.get("toolu_plan_1")).toEqual({
      plan: "1. ship it",
      status: "pending",
    })

    // Pre-plan narration persisted as an ACP-native agent record.
    expect(h.records).toEqual<AcpMessageRecord[]>([
      { role: "user", content: [{ type: "text", text: "plan it" }] },
      { role: "agent", content: [{ type: "text", text: "My plan:" }] },
    ])

    // A reload renders the narration, the plan card (from its pending row), and
    // the live view shows the same pending card.
    const reload = reloadMessages(h.records, h.planRows)
    expect(reload).toEqual<AgentMessage[]>([
      { role: "user", content: "plan it" },
      { role: "assistant", content: "My plan:" },
      {
        role: "plan",
        content: "1. ship it",
        status: "pending",
        planId: "toolu_plan_1",
      },
    ])
  })

  // #909: a user stop reads the same live and after reload. The stop goes
  // through Turn Launch (`stopTurn`, what `/api/agent/stop` calls) after the
  // response went out but before the background turn runs, so the watchdog
  // aborts the Engine and the abort surfaces as a thrown stream error.
  it("/stop: a stopped turn renders the same live and after reload, with no error", async () => {
    const h = liveHarness()

    const driver: StreamDriver = () => ({
      consumeStream: async () => {
        throw new Error("aborted")
      },
    })
    const { result, afterResponse } = await h.launch("hi", driver)
    expect(result).toEqual({ kind: "started", runId: RUN_ID })
    await h.stop()
    await afterResponse()

    // The stop is recorded as the user's, not a failure, and nothing durable
    // was persisted beyond the user turn.
    expect(h.rows.get(RUN_ID)).toBe("aborted")
    expect(h.records).toEqual<AcpMessageRecord[]>([
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ])
    // No error on the control channel: a stop is not a failure.
    expect(
      h.broadcasts.filter(
        (e) => e.type === "chat-control" && e.control.kind === "error"
      )
    ).toEqual([])
    expect(h.broadcasts.at(-1)?.type).toBe("chat-stream-end")

    const expected: AgentMessage[] = [
      { role: "user", content: "hi" },
      { role: "stopped" },
    ]
    expect(liveMessages(h.broadcasts)).toEqual(expected)
    expect(reloadMessages(h.records, h.planRows, new Map(), h.rows)).toEqual(
      expected
    )
  })

  // A superseded run (a new message or a plan resolution replaced it) leaves
  // nothing in the transcript, live or on reload: the next turn carries on.
  it("a superseded turn leaves no marker and no error, live or after reload", async () => {
    const h = liveHarness()

    const driver: StreamDriver = () => ({
      consumeStream: async () => {
        throw new Error("aborted")
      },
    })
    const { afterResponse } = await h.launch("hi", driver)
    await h.runState.transition(RUN_ID, "superseded")
    await afterResponse()

    const expected: AgentMessage[] = [{ role: "user", content: "hi" }]
    expect(liveMessages(h.broadcasts)).toEqual(expected)
    expect(reloadMessages(h.records, h.planRows, new Map(), h.rows)).toEqual(
      expected
    )
  })

  describe("plan resume: accept, reject and implicit reject share one resolution path", () => {
    /** Pause a turn on a plan, then return the broadcasts it produced. */
    const pausedOnPlan = async () => {
      const h = liveHarness()
      await h.run("plan it", planDriver)
      expect(h.rows.get("run_1")).toBe("paused_for_plan")
      return { h, before: h.broadcasts.length }
    }

    const cases = [
      {
        name: "accept (plan route)",
        text: planResolutionText({ approved: true }),
        planDecision: { planId: "toolu_plan_1", approved: true },
        status: "approved" as const,
      },
      {
        name: "reject with feedback (plan route)",
        text: planResolutionText({
          approved: false,
          feedback: "Use a queue instead.",
        }),
        planDecision: {
          planId: "toolu_plan_1",
          approved: false,
          feedback: "Use a queue instead.",
        },
        status: "rejected" as const,
      },
      {
        name: "implicit reject (a follow-up message on the stream route)",
        text: "Use a queue instead.",
        planDecision: undefined,
        status: "rejected" as const,
      },
    ]

    for (const c of cases) {
      it(c.name, async () => {
        const { h, before } = await pausedOnPlan()

        const result = await h.run(c.text, replyDriver("On it."), {
          planDecision: c.planDecision,
        })
        expect(result).toEqual({ kind: "started", runId: "run_2" })

        // The plan is resolved once, its paused run superseded, and the
        // resumed run completes.
        expect(h.planRows.get("toolu_plan_1")?.status).toBe(c.status)
        expect(h.rows.get("run_1")).toBe("superseded")
        expect(h.rows.get("run_2")).toBe("completed")

        // The decision lands as the next user turn: the continuation the agent
        // acts on.
        expect(h.records.slice(-2)).toEqual<AcpMessageRecord[]>([
          { role: "user", content: [{ type: "text", text: c.text }] },
          { role: "agent", content: [{ type: "text", text: "On it." }] },
        ])

        // Live clients get the card flip inside the replay window: after the
        // start marker, before the user echo.
        const resumed = h.broadcasts.slice(before)
        expect(resumed.map((e) => e.type)).toEqual([
          "chat-stream-start",
          "chat-control", // plan_resolved
          "chat-acp-update", // user echo
          "chat-acp-update", // "On it."
          "chat-stream-end",
        ])
        expect(resumed[1]).toMatchObject({
          control: {
            kind: "plan_resolved",
            planId: "toolu_plan_1",
            approved: c.status === "approved",
          },
        })

        // A reload shows what live clients saw: the resolved card, then the
        // decision and the reply.
        const live = liveMessages(h.broadcasts)
        const reload = reloadMessages(h.records, h.planRows, h.planAt)
        expect(reload).toEqual<AgentMessage[]>([
          { role: "user", content: "plan it" },
          { role: "assistant", content: "My plan:" },
          {
            role: "plan",
            content: "1. ship it",
            status: c.status,
            planId: "toolu_plan_1",
          },
          { role: "user", content: c.text },
          { role: "assistant", content: "On it." },
        ])
        expect(live).toEqual(reload)
      })
    }

    it("a decision on a plan a follow-up already rejected changes nothing", async () => {
      const { h } = await pausedOnPlan()
      await h.run("Use a queue instead.", replyDriver("On it."))
      const records = h.records.length
      const broadcasts = h.broadcasts.length

      const { result } = await h.launch(
        planResolutionText({ approved: true }),
        replyDriver("never"),
        {},
        { planDecision: { planId: "toolu_plan_1", approved: true } }
      )

      expect(result).toEqual({ kind: "plan-already-resolved" })
      expect(h.planRows.get("toolu_plan_1")?.status).toBe("rejected")
      expect(h.records).toHaveLength(records)
      expect(h.broadcasts).toHaveLength(broadcasts)
      expect(h.rows.has("run_3")).toBe(false)
    })

    it("a follow-up with no pending plan resolves nothing", async () => {
      const h = liveHarness()
      await h.run("hi", replyDriver("Hello"))
      expect(
        h.broadcasts.some(
          (e) => e.type === "chat-control" && e.control.kind === "plan_resolved"
        )
      ).toBe(false)
    })
  })
})
