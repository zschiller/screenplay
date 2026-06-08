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
import { InProcessEngine, type StreamDriver } from "./in-process-engine"
import {
  createRunState,
  type PendingPlanCall,
  type RunStateRepo,
  type RunStatus,
} from "../run-state"
import { renderHistory, type HistoryEntry } from "@/lib/agent/history-render"
import { wireToContentBlocks } from "./markers"
import { userMessageChunk } from "./schema"
import type { AcpMessageRecord, AcpToolCallRecord } from "./record"
import { chatStore, type ChatBroadcastEvent } from "@/lib/chat-store"
import type { AgentMessage } from "@/lib/agent/types"

/**
 * The keystone end-to-end live-route seam test (ADR 0006, issue #397). It drives
 * what `/api/agent/stream` and `/api/agent/plan` now drive —
 * `Engine.run → AcpUpdateConsumer` through {@link driveEngineTurn}, with the
 * abort watchdog at this boundary — over an **injected fake `StreamDriver`**,
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
function liveHarness(seedStatus: RunStatus = "running") {
  const records: AcpMessageRecord[] = []
  const toolCalls = new Map<string, AcpToolCallRecord>()
  const planRows = new Map<
    string,
    { plan: string; status: "pending" | "approved" | "rejected" }
  >()
  const broadcasts: ChatBroadcastEvent[] = []
  let n = 0
  const mintId = () => `evt_${++n}`

  const rows = new Map<string, RunStatus>([[RUN_ID, seedStatus]])
  const repo: RunStateRepo = {
    async loadStatus(id) {
      return rows.get(id) ?? null
    },
    async applyTransition(id, to) {
      rows.set(id, to)
    },
    async supersedeActiveRuns() {},
    async insertRunning() {
      return RUN_ID
    },
    async pauseForPlan(id: string, planCall: PendingPlanCall) {
      rows.set(id, "paused_for_plan")
      planRows.set(planCall.toolCallId, {
        plan: String((planCall.input as { plan?: unknown }).plan ?? ""),
        status: "pending",
      })
    },
    async resolvePlan() {
      return null
    },
  }
  const runState = createRunState(repo)

  const ports: AcpConsumerPorts = {
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
      await runState.transition(RUN_ID, to)
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
      await runState.pauseForPlan(RUN_ID, { ...planCall, chatId: CHAT_ID })
    },
  }

  /**
   * Mirror what the route does synchronously before the engine runs: append the
   * incoming user turn as an ACP-native `user` record (decorated wire text →
   * content blocks) and broadcast the start + the live user echo.
   */
  const openTurnWithUser = (text: string) => {
    broadcasts.push({
      type: "chat-stream-start",
      chatId: CHAT_ID,
      id: mintId(),
    })
    records.push({ role: "user", content: wireToContentBlocks(text) })
    broadcasts.push({
      type: "chat-acp-update",
      chatId: CHAT_ID,
      id: mintId(),
      update: userMessageChunk(text),
    })
  }

  const consumer = new AcpUpdateConsumer(ports)

  const run = (driver: StreamDriver) =>
    driveEngineTurn(
      new InProcessEngine(driver),
      {
        chatId: CHAT_ID,
        runId: RUN_ID,
        roomId: ROOM_ID,
        systemPrompt: "sys",
        model: "anthropic:test",
        history: records.slice(),
      },
      consumer,
      { isRunActive: (id) => runState.isRunActive(id) }
    )

  return {
    records,
    toolCalls,
    planRows,
    broadcasts,
    rows,
    run,
    openTurnWithUser,
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
  >
): AgentMessage[] {
  const entries: HistoryEntry[] = records.map((record) => ({
    kind: "record",
    record,
  }))
  for (const [planId, row] of planRows) {
    entries.push({ kind: "plan", planId, plan: row.plan, status: row.status })
  }
  return renderHistory(entries)
}

describe("keystone — live-route seam (stream/plan → Engine.run → AcpUpdateConsumer)", () => {
  it("a plain text turn: ACP-native records, ACP-shaped broadcasts, completion, and a reload that rebuilds the live view", async () => {
    const h = liveHarness()
    h.openTurnWithUser("hi")

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
    await h.run(driver)

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
    h.openTurnWithUser("plan it")

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
    await h.run(driver)

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

  it("/stop: the watchdog aborts the in-flight turn and it reports a stop, not a failure", async () => {
    // Seed the run already `aborted` — exactly what a `/stop` (or supersession)
    // leaves behind when it trips the watchdog before the background turn runs.
    const h = liveHarness("aborted")
    h.openTurnWithUser("hi")

    const driver: StreamDriver = () => ({
      consumeStream: async () => {
        throw new Error("aborted")
      },
    })
    await h.run(driver)

    // A stop, not a failure: "Stopped by user" surfaces on the control channel,
    // the run stays `aborted` (the consumer's `failed` transition no-ops), and
    // nothing durable was persisted beyond the user turn.
    const control = h.broadcasts.find((e) => e.type === "chat-control")
    expect(control).toMatchObject({
      control: { kind: "error", message: "Stopped by user" },
    })
    expect(h.rows.get(RUN_ID)).toBe("aborted")
    expect(h.records).toEqual<AcpMessageRecord[]>([
      { role: "user", content: [{ type: "text", text: "hi" }] },
    ])
    expect(h.broadcasts.at(-1)?.type).toBe("chat-stream-end")
  })
})
