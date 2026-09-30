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
  type TurnTarget,
} from "../turn-launch"
import { InProcessEngine, type StreamDriver } from "./in-process-engine"
import { acpSessionFactoryFromDriver, steppedDriver } from "./engine-contract"
import { ExternalEngine } from "./acp-engine"
import type { Engine } from "./engine-seam"
import {
  createRunState,
  type PendingPlanCall,
  type RunStateRepo,
  type RunStatus,
} from "../run-state"
import { renderHistory, type HistoryEntry } from "@/lib/agent/history-render"
import { contentBlocksToWire, wireToContentBlocks } from "./markers"
import { userMessageChunk } from "./schema"
import type { Steer, SteerInbox } from "../steer-inbox"
import { planResolutionText } from "./resolution"
import type { AcpMessageRecord, AcpToolCallRecord } from "./record"
import { chatStore, type ChatBroadcastEvent } from "@/lib/chat-store"
import type { AgentMessage } from "@/lib/agent/types"
import type { WorkspaceTurnEnd } from "../coordinator-wake"

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
function liveHarness(
  makeEngine: (driver: StreamDriver) => Engine = (driver) =>
    new InProcessEngine(driver)
) {
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

  // The Steer inbox (#1190) over in-memory rows, with the live inbox's
  // guards: a take only happens while the run is `running`, and every write
  // that ends a Steer's pending life happens once.
  const steerRows: Array<Steer & { runId: string; taken: boolean }> = []
  let steerSeq = 0
  const pendingOn = (runId: string) =>
    steerRows.filter((r) => r.runId === runId && !r.taken)
  const removeRows = (gone: Steer[]) => {
    for (const row of gone) steerRows.splice(steerRows.indexOf(row as never), 1)
  }
  const toSteer = ({ id, message, userId }: Steer): Steer => ({
    id,
    message,
    userId,
  })
  const inbox: SteerInbox = {
    async add({ runId, message, userId }) {
      const row = {
        id: `steer_${++steerSeq}`,
        runId,
        message,
        userId,
        taken: false,
      }
      steerRows.push(row)
      return toSteer(row)
    },
    async take(runId) {
      if (rows.get(runId) !== "running") return []
      const taken = pendingOn(runId)
      for (const row of taken) row.taken = true
      return taken.map(toSteer)
    },
    async drain(runId) {
      const left = pendingOn(runId)
      removeRows(left)
      return left.map(toSteer)
    },
    async reclaim(id) {
      const row = steerRows.find((r) => r.id === id && !r.taken)
      if (row) removeRows([row])
      return !!row
    },
  }
  const latestActiveRun = () => {
    let active: { id: string; status: "running" | "paused_for_plan" } | null =
      null
    for (const [id, status] of rows) {
      if (status === "running" || status === "paused_for_plan")
        active = { id, status }
    }
    return active
  }
  // Every Coordinator wake Turn Launch asked for, in order.
  const wakes: WorkspaceTurnEnd[] = []

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
    // What the live port does: each taken Steer joins the log as a user
    // record, then clients drop it from pending and draw its echo.
    async settleSteers(steers) {
      for (const steer of steers) {
        records.push({ role: "user", content: steer.content })
      }
      broadcasts.push({
        type: "chat-control",
        chatId: CHAT_ID,
        id: mintId(),
        control: { kind: "steers_taken", ids: steers.map((s) => s.id) },
      })
      for (const steer of steers) {
        await this.broadcastUpdate(
          userMessageChunk(contentBlocksToWire(steer.content))
        )
      }
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
      resolveEngine: async () => makeEngine(driver),
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
          {
            isRunActive: (id) => runState.isRunActive(id),
            takeSteers: async (id) =>
              (await inbox.take(id)).map((steer) => ({
                id: steer.id,
                content: wireToContentBlocks(steer.message),
              })),
            // What the live route does when the Engine declines.
            declineSteers: () =>
              deps.broadcastControl(ROOM_ID, CHAT_ID, {
                kind: "steerable",
                steerable: false,
              }),
          }
        ),
      loadRunStatus: (id) => runState.runStatus(id),
      async wakeCoordinator(end) {
        wakes.push(end)
      },
      runAfterResponse: (task) => {
        afterResponse.push(task)
      },
      findActiveRun: async () => latestActiveRun(),
      isRunActive: (id) => runState.isRunActive(id),
      latestRunStatus: async () => [...rows.values()].at(-1) ?? null,
      steers: inbox,
    }
    // Leftover Steers start the chat's next turn through the same target.
    const target = (message: string): TurnTarget => ({
      prepare: async () => ({
        systemPrompt: "sys",
        model: "anthropic:test",
        tools: {},
        userText: message,
        ...prepared,
      }),
      followUp: target,
    })
    const result = await launchTurn(
      deps,
      { roomId: ROOM_ID, chatId: CHAT_ID, message: text, ...request },
      target(text)
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
    request: Partial<TurnRequest> = {},
    prepared: Partial<PreparedTurn> = {}
  ) => {
    const { result, afterResponse } = await launch(
      text,
      driver,
      prepared,
      request
    )
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
    wakes,
    steerRows,
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
      "chat-control", // steerable
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
          "chat-control", // steerable
          "chat-control", // plan_resolved
          "chat-acp-update", // user echo
          "chat-acp-update", // "On it."
          "chat-stream-end",
        ])
        expect(resumed[2]).toMatchObject({
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

  // #897: a Workspace turn wakes the Coordinator once, however it ends.
  describe("Retry on a failed turn (#1228)", () => {
    const failing: StreamDriver = (config) => ({
      consumeStream: async () => {
        await config.onError?.({ error: new Error("model overloaded") })
      },
    })
    /** A driver that records the model input it was handed, then replies. */
    const recording = (sent: unknown[][]): StreamDriver => {
      const reply = replyDriver("Done.")
      return (config) => {
        sent.push(config.messages ?? [])
        return reply(config)
      }
    }

    it("runs the turn again on the one copy of the ask, live, after reload and in the model input", async () => {
      const h = liveHarness()
      await h.run("fix it", failing)
      // A second failure still leaves one copy.
      await h.run("fix it", failing, { retry: true })
      const sent: unknown[][] = []
      await h.run("fix it", recording(sent), { retry: true })

      expect(h.records).toEqual<AcpMessageRecord[]>([
        { role: "user", content: [{ type: "text", text: "fix it" }] },
        { role: "agent", content: [{ type: "text", text: "Done." }] },
      ])
      expect(sent).toHaveLength(1)
      expect(sent[0]).toEqual([
        expect.objectContaining({ role: "user", content: "fix it" }),
      ])

      const asks = (messages: AgentMessage[]) =>
        messages.filter((m) => m.role === "user")
      expect(asks(liveMessages(h.broadcasts))).toEqual([
        { role: "user", content: "fix it" },
      ])
      expect(reloadMessages(h.records, h.planRows)).toEqual<AgentMessage[]>([
        { role: "user", content: "fix it" },
        { role: "assistant", content: "Done." },
      ])
    })

    it("a retry after the chat moved on is a new message", async () => {
      const h = liveHarness()
      await h.run("fix it", failing)
      await h.run("something else", replyDriver("Sure."))
      await h.run("fix it", replyDriver("Done."), { retry: true })
      expect(
        h.records.filter((r) => r.role === "user").map((r) => r.content)
      ).toEqual([
        [{ type: "text", text: "fix it" }],
        [{ type: "text", text: "something else" }],
        [{ type: "text", text: "fix it" }],
      ])
    })
  })

  describe("Coordinator wakes", () => {
    const workspaceTurn = { wakesCoordinator: true }
    const woke = (runId: string, status: WorkspaceTurnEnd["status"]) => [
      { roomId: ROOM_ID, chatId: CHAT_ID, runId, status },
    ]

    it("a completed Workspace turn wakes the Coordinator exactly once, after the turn is over", async () => {
      const h = liveHarness()
      const { afterResponse } = await h.launch(
        "fix it",
        replyDriver("Fixed."),
        workspaceTurn
      )
      // Not while the turn is still to run.
      expect(h.wakes).toEqual([])
      await afterResponse()
      expect(h.rows.get(RUN_ID)).toBe("completed")
      expect(h.wakes).toEqual(woke(RUN_ID, "completed"))
    })

    it("a user-driven turn wakes it too: nothing about the sender decides", async () => {
      const h = liveHarness()
      // Typed by the user in the Workspace: no `[from coordinator: …]` marker.
      await h.run("rename the button", replyDriver("Done."), {}, workspaceTurn)
      expect(h.wakes).toEqual(woke(RUN_ID, "completed"))
    })

    it("a failed turn wakes it with `failed`", async () => {
      const h = liveHarness()
      const driver: StreamDriver = (config) => ({
        consumeStream: async () => {
          await config.onError?.({ error: new Error("model overloaded") })
        },
      })
      await h.run("fix it", driver, {}, workspaceTurn)
      expect(h.rows.get(RUN_ID)).toBe("failed")
      expect(h.wakes).toEqual(woke(RUN_ID, "failed"))
    })

    it("a stopped turn wakes it with `aborted`", async () => {
      const h = liveHarness()
      const driver: StreamDriver = () => ({
        consumeStream: async () => {
          throw new Error("aborted")
        },
      })
      const { afterResponse } = await h.launch("fix it", driver, workspaceTurn)
      await h.stop()
      await afterResponse()
      expect(h.wakes).toEqual(woke(RUN_ID, "aborted"))
    })

    it("a plan-approval pause wakes it with `paused_for_plan`, and the resumed turn wakes it again", async () => {
      const h = liveHarness()
      await h.run("plan it", planDriver, {}, workspaceTurn)
      expect(h.wakes).toEqual(woke("run_1", "paused_for_plan"))

      await h.run(
        planResolutionText({ approved: true }),
        replyDriver("Shipped."),
        { planDecision: { planId: "toolu_plan_1", approved: true } },
        workspaceTurn
      )
      expect(h.wakes).toEqual([
        ...woke("run_1", "paused_for_plan"),
        ...woke("run_2", "completed"),
      ])
    })

    it("a superseded turn wakes nothing: the turn that replaced it will", async () => {
      const h = liveHarness()
      const driver: StreamDriver = () => ({
        consumeStream: async () => {
          throw new Error("aborted")
        },
      })
      const { afterResponse } = await h.launch("hi", driver, workspaceTurn)
      await h.runState.transition(RUN_ID, "superseded")
      await afterResponse()
      expect(h.wakes).toEqual([])
    })

    it("a turn on anything but a Workspace wakes nothing", async () => {
      const h = liveHarness()
      await h.run("hi", replyDriver("Hello"))
      expect(h.wakes).toEqual([])
    })
  })

  describe("steering (#1190)", () => {
    const say = (text: string) => ({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      chunks: [{ type: "text-delta", id: "t", text } as any],
      response: [{ role: "assistant" as const, content: text }],
    })
    const userTexts = (messages: AgentMessage[]) =>
      messages.flatMap((m) => (m.role === "user" ? [m.content] : []))

    it("a message sent mid-turn joins the running turn where the agent takes it, live and after reload", async () => {
      const h = liveHarness()
      let steered: unknown
      const driver = steppedDriver(
        [
          [
            {
              ...say("Renamed it."),
              chunks: [
                ...say("Renamed it.").chunks,
                async () => {
                  steered = (await h.launch("update the docs too", driver))
                    .result
                },
              ],
            },
          ],
          [say("Docs updated.")],
        ],
        []
      )
      await h.run("rename the flag", driver)

      // The send steered the run rather than superseding it.
      expect(steered).toEqual({ kind: "steered", steerId: "steer_1" })
      expect([...h.rows]).toEqual([["run_1", "completed"]])
      expect(h.records.map((r) => r.role)).toEqual([
        "user",
        "agent",
        "user",
        "agent",
      ])

      // Every client showed it pending, then settled it where the agent took
      // it, and a reload rebuilds exactly that.
      const pendingAt = h.broadcasts.findIndex(
        (e) => e.type === "chat-control" && e.control.kind === "steer_pending"
      )
      const takenAt = h.broadcasts.findIndex(
        (e) => e.type === "chat-control" && e.control.kind === "steers_taken"
      )
      expect(pendingAt).toBeGreaterThan(-1)
      expect(takenAt).toBeGreaterThan(pendingAt)
      const live = liveMessages(h.broadcasts)
      expect(live).toEqual(reloadMessages(h.records, h.planRows))
      expect(live.map((m) => m.role)).toEqual([
        "user",
        "assistant",
        "user",
        "assistant",
      ])
      expect(userTexts(live)).toEqual([
        "rename the flag",
        "update the docs too",
      ])
    })

    it("Steers left when the run pauses for a plan start the next turn, which rejects the plan with them", async () => {
      const h = liveHarness()
      let calls = 0
      const driver: StreamDriver = (config) => {
        calls++
        if (calls === 1) {
          return {
            consumeStream: async () => {
              await h.launch("keep the old endpoint", driver)
              await planDriver(config).consumeStream()
            },
          }
        }
        return replyDriver("Revised.")(config)
      }
      await h.run("plan the migration", driver)

      expect(h.rows.get("run_1")).toBe("superseded")
      expect(h.rows.get("run_2")).toBe("completed")
      expect(h.planRows.get("toolu_plan_1")?.status).toBe("rejected")
      expect(h.steerRows).toEqual([])
      const live = liveMessages(h.broadcasts)
      expect(userTexts(live)).toEqual([
        "plan the migration",
        "keep the old endpoint",
      ])
      expect(live).toEqual(
        reloadMessages(h.records, h.planRows, h.planAt, h.rows)
      )
    })

    it("a stop hands pending Steers back instead of taking them", async () => {
      const h = liveHarness()
      const driver = steppedDriver(
        [
          [
            {
              ...say("Working"),
              chunks: [
                ...say("Working").chunks,
                async () => {
                  await h.launch("actually, wait", driver)
                  await h.stop()
                },
              ],
            },
            say("never"),
          ],
        ],
        []
      )
      await h.run("migrate everything", driver)

      expect(h.rows.get("run_1")).toBe(STOPPED_RUN_STATUS)
      expect(h.steerRows).toEqual([])
      expect(
        h.records.some((r) =>
          r.content.some((b) => "text" in b && b.text === "actually, wait")
        )
      ).toBe(false)
      expect(
        h.broadcasts.find(
          (e) =>
            e.type === "chat-control" && e.control.kind === "steers_returned"
        )
      ).toMatchObject({
        control: {
          kind: "steers_returned",
          steers: [{ id: "steer_1", message: "actually, wait" }],
        },
      })
    })
  })

  describe("steering a Harness turn (#1191)", () => {
    const harness = (promptQueueing: boolean) =>
      liveHarness(
        (driver) =>
          new ExternalEngine({
            sessionFactory: acpSessionFactoryFromDriver(driver, {
              promptQueueing,
            }),
          })
      )
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const read = {
      start: { type: "tool-input-start", id: "call_1", toolName: "read" },
      call: { type: "tool-call", toolCallId: "call_1", toolName: "read" },
      result: {
        type: "tool-result",
        toolCallId: "call_1",
        toolName: "read",
        output: "x",
      },
    } as Record<string, any>
    const say = (text: string) => ({
      chunks: [{ type: "text-delta", id: "t", text } as any],
      response: [{ role: "assistant" as const, content: text }],
    })
    /* eslint-enable @typescript-eslint/no-explicit-any */
    const controls = (h: ReturnType<typeof liveHarness>) =>
      h.broadcasts.flatMap((e) =>
        e.type === "chat-control" ? [e.control] : []
      )

    it("a message sent mid-turn joins the Harness's live turn, and the run ends once", async () => {
      const h = harness(true)
      let steered: unknown
      const driver = steppedDriver(
        [
          [
            {
              chunks: [
                read.start,
                read.call,
                async () => {
                  steered = (await h.launch("run the tests too", driver)).result
                },
                read.result,
              ],
              response: [],
            },
            say("Tests pass."),
          ],
        ],
        []
      )
      await h.run("fix the bug", driver)

      expect(steered).toEqual({ kind: "steered", steerId: "steer_1" })
      expect([...h.rows]).toEqual([["run_1", "completed"]])
      expect(h.steerRows.map((r) => r.taken)).toEqual([true])
      expect(h.records.map((r) => r.role)).toEqual(["user", "user", "agent"])
      expect(
        h.broadcasts.filter((e) => e.type === "chat-stream-end")
      ).toHaveLength(1)
      expect(controls(h)).not.toContainEqual({
        kind: "steerable",
        steerable: false,
      })
    })

    it("a stop cancels the Harness's turn and hands pending Steers back", async () => {
      const h = harness(true)
      const driver = steppedDriver(
        [
          [
            {
              chunks: [
                ...say("Working").chunks,
                async () => {
                  await h.launch("actually, wait", driver)
                  await h.stop()
                },
              ],
              response: [],
            },
            say("never"),
          ],
        ],
        []
      )
      await h.run("migrate everything", driver)

      expect(h.rows.get("run_1")).toBe(STOPPED_RUN_STATUS)
      expect(h.steerRows).toEqual([])
      expect(controls(h)).toContainEqual({
        kind: "steers_returned",
        steers: [{ id: "steer_1", message: "actually, wait", userId: null }],
      })
      expect(
        h.records.some((r) =>
          r.content.some((b) => "text" in b && b.text === "actually, wait")
        )
      ).toBe(false)
    })

    it("a Harness that doesn't queue prompts tells clients to queue, and a message that joined first starts the next turn", async () => {
      const h = harness(false)
      let calls = 0
      const driver: StreamDriver = (config) => {
        calls++
        if (calls > 1) return replyDriver("Docs too.")(config)
        return {
          consumeStream: async () => {
            await h.launch("update the docs too", driver)
            await replyDriver("Renamed it.")(config).consumeStream()
          },
        }
      }
      await h.run("rename the flag", driver)

      expect(controls(h)).toContainEqual({
        kind: "steerable",
        steerable: false,
      })
      expect(h.rows.get("run_1")).toBe("completed")
      expect(h.rows.get("run_2")).toBe("completed")
      expect(h.steerRows).toEqual([])
      expect(
        h.records.flatMap((r) =>
          r.role === "user"
            ? r.content.flatMap((b) => ("text" in b ? [b.text] : []))
            : []
        )
      ).toEqual(["rename the flag", "update the docs too"])
    })
  })
})
