import { describe, expect, it, vi } from "vitest"

// `run-state` binds to the live Drizzle handle at import time; this test drives
// it through an injected in-memory repo, so stub the db boundary that would
// otherwise demand a real DATABASE_URL (mirrors engine.test.ts).
vi.mock("@/lib/db", () => ({ db: {} }))

import {
  AcpUpdateConsumer,
  type AcpConsumerPorts,
  type ConsumerPlanCall,
} from "./consumer"
import type { EngineUpdate } from "./engine-seam"
import type { AcpMessageRecord, AcpToolCallRecord } from "./record"
import {
  agentMessageChunk,
  agentThoughtChunk,
  planPermissionRequest,
  toolCallStart,
  toolCallUpdate,
  type RequestPermissionRequest,
  type SessionUpdate,
  type ToolCallContent,
} from "./schema"
import {
  createRunState,
  type PendingPlanCall,
  type RunStateRepo,
  type RunStatus,
} from "../run-state"

/**
 * In-memory ports + a real `createRunState` over an in-memory run row, so the
 * consumer drives the genuine transition guards (legal edges, terminal no-op).
 * We assert on the *observable outcome* — the broadcasts, the persisted
 * ACP-native records, and the recorded run status — never on how they were
 * produced. Mirrors `engine.test.ts`'s `fakeRuns`.
 */
function harness(seedStatus: RunStatus = "running") {
  const broadcasts: SessionUpdate[] = []
  const permissionRequests: RequestPermissionRequest[] = []
  const errors: string[] = []
  const records: AcpMessageRecord[] = []
  const pausedCalls: PendingPlanCall[] = []
  // Tool calls persist *in place* by id, so the harness mirrors the live
  // upsert with a Map — its final values are the durable records.
  const toolCalls = new Map<string, AcpToolCallRecord>()
  // The durable writes in the order they happened, across both ports, so a test
  // can assert that narration lands *between* tool calls (the reload ordering)
  // rather than batched at turn end. Tool entries carry the call id (an upsert
  // appears once per status transition); record entries carry the record.
  const writeLog: Array<
    { kind: "record"; record: AcpMessageRecord } | { kind: "tool"; id: string }
  > = []
  let ends = 0

  const rows = new Map<string, RunStatus>([["run_1", seedStatus]])
  const repo: RunStateRepo = {
    async loadStatus(id) {
      return rows.get(id) ?? null
    },
    async applyTransition(id, to) {
      rows.set(id, to)
    },
    async supersedeActiveRuns() {},
    async insertRunning() {
      return "run_1"
    },
    async pauseForPlan(id, planCall) {
      rows.set(id, "paused_for_plan")
      pausedCalls.push(planCall)
    },
    async resolvePlan() {
      return null
    },
  }
  const runState = createRunState(repo)

  const ports: AcpConsumerPorts = {
    async broadcastUpdate(update) {
      broadcasts.push(update)
    },
    async broadcastError(message) {
      errors.push(message)
    },
    async broadcastEnd() {
      ends++
    },
    async appendRecord(record) {
      records.push(record)
      writeLog.push({ kind: "record", record })
    },
    async upsertToolCall(record) {
      toolCalls.set(record.toolCallId, record)
      writeLog.push({ kind: "tool", id: record.toolCallId })
    },
    async transition(to) {
      await runState.transition("run_1", to)
    },
    async broadcastPermissionRequest(request) {
      permissionRequests.push(request)
    },
    async pauseForPlan(planCall: ConsumerPlanCall) {
      // The live port adds the chat id; the in-memory run-state needs it too.
      await runState.pauseForPlan("run_1", { ...planCall, chatId: "chat_1" })
    },
  }

  return {
    consumer: new AcpUpdateConsumer(ports),
    broadcasts,
    permissionRequests,
    errors,
    records,
    pausedCalls,
    toolCalls,
    writeLog,
    statusOf: () => rows.get("run_1"),
    endCount: () => ends,
  }
}

async function feed(consumer: AcpUpdateConsumer, updates: EngineUpdate[]) {
  for (const u of updates) await consumer.handle(u)
}

describe("AcpUpdateConsumer — text path", () => {
  it("broadcasts each chunk, persists one ACP-native agent record, completes the run, and ends the stream", async () => {
    const h = harness()
    await feed(h.consumer, [
      { kind: "session_update", update: agentMessageChunk("Hel") },
      { kind: "session_update", update: agentMessageChunk("lo") },
      { kind: "done", stopReason: "end_turn" },
    ])

    // Every chunk is broadcast ACP-shaped so clients render the live stream.
    expect(h.broadcasts).toEqual([
      agentMessageChunk("Hel"),
      agentMessageChunk("lo"),
    ])
    // The whole turn persists as one ACP-native agent record.
    expect(h.records).toEqual<AcpMessageRecord[]>([
      { role: "agent", content: [{ type: "text", text: "Hello" }] },
    ])
    expect(h.statusOf()).toBe("completed")
    expect(h.endCount()).toBe(1)
  })

  it("broadcasts reasoning and persists it as a thought record before the agent reply", async () => {
    const h = harness()
    await feed(h.consumer, [
      { kind: "session_update", update: agentThoughtChunk("think") },
      { kind: "session_update", update: agentThoughtChunk("ing") },
      { kind: "session_update", update: agentMessageChunk("Hello") },
      { kind: "done", stopReason: "end_turn" },
    ])

    // Reasoning chunks are broadcast ACP-shaped alongside the message stream so
    // a streaming agent's thinking isn't dropped.
    expect(h.broadcasts).toEqual([
      agentThoughtChunk("think"),
      agentThoughtChunk("ing"),
      agentMessageChunk("Hello"),
    ])
    // The turn persists ACP-native: the reasoning record first, then the reply.
    expect(h.records).toEqual<AcpMessageRecord[]>([
      { role: "thought", content: [{ type: "text", text: "thinking" }] },
      { role: "agent", content: [{ type: "text", text: "Hello" }] },
    ])
    expect(h.statusOf()).toBe("completed")
    expect(h.endCount()).toBe(1)
  })

  it("persists a thought record even when the turn produced only reasoning", async () => {
    const h = harness()
    await feed(h.consumer, [
      { kind: "session_update", update: agentThoughtChunk("just musing") },
      { kind: "done", stopReason: "end_turn" },
    ])

    expect(h.records).toEqual<AcpMessageRecord[]>([
      { role: "thought", content: [{ type: "text", text: "just musing" }] },
    ])
    expect(h.statusOf()).toBe("completed")
  })

  it("does not persist a record for a turn that produced no text", async () => {
    const h = harness()
    await feed(h.consumer, [{ kind: "done", stopReason: "end_turn" }])

    expect(h.records).toEqual([])
    expect(h.statusOf()).toBe("completed")
    expect(h.endCount()).toBe(1)
  })

  it("records a genuine error as failed and surfaces the message", async () => {
    const h = harness()
    await feed(h.consumer, [
      { kind: "session_update", update: agentMessageChunk("partial") },
      { kind: "error", message: "model exploded" },
    ])

    expect(h.errors).toEqual(["model exploded"])
    expect(h.statusOf()).toBe("failed")
    // No durable record on failure — the partial text was broadcast only.
    expect(h.records).toEqual([])
    expect(h.endCount()).toBe(1)
  })

  // A user `/stop` (or supersession) already moved the run to a terminal state
  // before the abort surfaced as an error. The consumer's `failed` transition
  // must no-op so the recorded outcome (aborted) is preserved.
  for (const terminal of ["aborted", "superseded"] as const) {
    it(`preserves an already-terminal (${terminal}) run on a stop`, async () => {
      const h = harness(terminal)
      await feed(h.consumer, [{ kind: "error", message: "Stopped by user" }])

      expect(h.errors).toEqual(["Stopped by user"])
      expect(h.statusOf()).toBe(terminal)
      expect(h.endCount()).toBe(1)
    })
  }

  // A clean ACP cancellation arrives as `done` with `stopReason: "cancelled"`
  // (the path a real ACP agent takes when it acknowledges a `session/cancel`).
  // The consumer must treat it as a stop, never a completion: no `completed`
  // transition, the "Stopped by user" outcome surfaced, the stream closed.
  it("treats a cancelled done as a stop, not a completion", async () => {
    const h = harness("aborted")
    await feed(h.consumer, [
      { kind: "session_update", update: agentMessageChunk("partial") },
      { kind: "done", stopReason: "cancelled" },
    ])

    expect(h.errors).toEqual(["Stopped by user"])
    // The run keeps the terminal outcome the watchdog already recorded.
    expect(h.statusOf()).toBe("aborted")
    // No durable record on a stop — the partial text was broadcast only.
    expect(h.records).toEqual([])
    expect(h.endCount()).toBe(1)
  })

  it("never completes a cancelled done even if the run is somehow still live", async () => {
    // Guards the contract directly: the consumer does not own the stop, so it
    // must not mark a cancelled turn `completed` — it leaves the run untouched
    // for the run lifecycle to have terminated.
    const h = harness("running")
    await feed(h.consumer, [{ kind: "done", stopReason: "cancelled" }])

    expect(h.statusOf()).toBe("running")
    expect(h.errors).toEqual(["Stopped by user"])
    expect(h.endCount()).toBe(1)
  })

  it("maps a plan-mode permission request onto the pause: pending tool-call, paused run, broadcast, no completion", async () => {
    const h = harness()
    const request = planPermissionRequest({
      sessionId: "chat_1",
      toolCallId: "toolu_plan_1",
      plan: "## Plan\n1. do the thing",
    })
    await feed(h.consumer, [
      // Narration the agent streamed before submitting the plan.
      { kind: "session_update", update: agentMessageChunk("Here's my plan.") },
      { kind: "permission_request", request },
    ])

    // The gate is broadcast ACP-shaped so the Room renders the approval card —
    // it is NOT a `session/update` and never a completion.
    expect(h.permissionRequests).toEqual([request])
    // The run pauses (not completes) and carries the pending submit_plan call,
    // keyed by the verbatim tool-call id so the resume lines up.
    expect(h.statusOf()).toBe("paused_for_plan")
    expect(h.pausedCalls).toEqual<PendingPlanCall[]>([
      {
        toolCallId: "toolu_plan_1",
        chatId: "chat_1",
        toolName: "submit_plan",
        input: { plan: "## Plan\n1. do the thing" },
      },
    ])
    // Pre-plan narration still persists as one ACP-native record, and the turn
    // closes for clients exactly once.
    expect(h.records).toEqual<AcpMessageRecord[]>([
      { role: "agent", content: [{ type: "text", text: "Here's my plan." }] },
    ])
    expect(h.endCount()).toBe(1)
  })

  it("ignores a done after a permission request (the paused turn is closed)", async () => {
    const h = harness()
    await feed(h.consumer, [
      {
        kind: "permission_request",
        request: planPermissionRequest({
          sessionId: "chat_1",
          toolCallId: "toolu_plan_2",
          plan: "plan body",
        }),
      },
      { kind: "done", stopReason: "end_turn" },
    ])

    expect(h.statusOf()).toBe("paused_for_plan")
    expect(h.endCount()).toBe(1)
    // The trailing `done` must not complete the paused run nor re-close.
    expect(h.records).toEqual([])
  })

  it("ignores a done after a terminal error (single close)", async () => {
    const h = harness()
    await feed(h.consumer, [
      { kind: "error", message: "boom" },
      { kind: "done", stopReason: "end_turn" },
    ])

    expect(h.errors).toEqual(["boom"])
    expect(h.statusOf()).toBe("failed")
    expect(h.endCount()).toBe(1)
  })
})

// The reload bug this guards: narration used to be accumulated across the whole
// turn and flushed once at the end, so on reload it sorted *after* every tool
// call (which persist when first seen) and all its segments collapsed into one
// concatenated, separator-less block. These pin that each contiguous run is
// flushed at its boundary, in arrival order — the interleaving the live stream
// showed and the durable log must reproduce.
describe("AcpUpdateConsumer — reload ordering (flush on boundary)", () => {
  it("flushes narration around a tool call so it persists in arrival order, not batched at turn end", async () => {
    const h = harness()
    await feed(h.consumer, [
      { kind: "session_update", update: agentMessageChunk("Reading the file.") },
      {
        kind: "session_update",
        update: toolCallStart({ toolCallId: "c1", title: "read_file" }),
      },
      {
        kind: "session_update",
        update: toolCallUpdate({ toolCallId: "c1", status: "completed" }),
      },
      { kind: "session_update", update: agentMessageChunk("Found it.") },
      { kind: "done", stopReason: "end_turn" },
    ])

    // Two distinct agent records — the narration is split at the tool boundary,
    // never merged into one "Reading the file.Found it." block.
    expect(h.records).toEqual<AcpMessageRecord[]>([
      { role: "agent", content: [{ type: "text", text: "Reading the file." }] },
      { role: "agent", content: [{ type: "text", text: "Found it." }] },
    ])
    // …and the durable writes interleave: pre-call narration, the call's
    // updates, then post-call narration — the exact reload order.
    expect(h.writeLog).toEqual([
      {
        kind: "record",
        record: {
          role: "agent",
          content: [{ type: "text", text: "Reading the file." }],
        },
      },
      { kind: "tool", id: "c1" },
      { kind: "tool", id: "c1" },
      {
        kind: "record",
        record: { role: "agent", content: [{ type: "text", text: "Found it." }] },
      },
    ])
    expect(h.statusOf()).toBe("completed")
  })

  it("flushes reasoning then reply at the stream switch, both ahead of the tool call", async () => {
    const h = harness()
    await feed(h.consumer, [
      { kind: "session_update", update: agentThoughtChunk("Let me check.") },
      { kind: "session_update", update: agentMessageChunk("I'll read it.") },
      {
        kind: "session_update",
        update: toolCallStart({ toolCallId: "c1", title: "read_file" }),
      },
      { kind: "session_update", update: agentMessageChunk("Done.") },
      { kind: "done", stopReason: "end_turn" },
    ])

    expect(h.writeLog).toEqual([
      {
        kind: "record",
        record: {
          role: "thought",
          content: [{ type: "text", text: "Let me check." }],
        },
      },
      {
        kind: "record",
        record: {
          role: "agent",
          content: [{ type: "text", text: "I'll read it." }],
        },
      },
      { kind: "tool", id: "c1" },
      {
        kind: "record",
        record: { role: "agent", content: [{ type: "text", text: "Done." }] },
      },
    ])
  })

  it("splits reply→reasoning→reply into three records even with no tool between", async () => {
    const h = harness()
    await feed(h.consumer, [
      { kind: "session_update", update: agentMessageChunk("First.") },
      { kind: "session_update", update: agentThoughtChunk("Reconsidering.") },
      { kind: "session_update", update: agentMessageChunk("Second.") },
      { kind: "done", stopReason: "end_turn" },
    ])

    // The reasoning breaks the reply stream, so the two replies stay separate
    // records rather than concatenating into "First.Second.".
    expect(h.records).toEqual<AcpMessageRecord[]>([
      { role: "agent", content: [{ type: "text", text: "First." }] },
      { role: "thought", content: [{ type: "text", text: "Reconsidering." }] },
      { role: "agent", content: [{ type: "text", text: "Second." }] },
    ])
  })
})

describe("AcpUpdateConsumer — tool-call lifecycle", () => {
  const diff: ToolCallContent = {
    type: "diff",
    path: "src/a.ts",
    oldText: "old",
    newText: "new",
  }

  it("persists one tool-call record in place across pending → in_progress → completed and broadcasts each update", async () => {
    const h = harness()
    await feed(h.consumer, [
      {
        kind: "session_update",
        update: toolCallStart({
          toolCallId: "call_1",
          title: "edit_file",
          kind: "edit",
          status: "pending",
        }),
      },
      {
        kind: "session_update",
        update: toolCallUpdate({
          toolCallId: "call_1",
          status: "in_progress",
          rawInput: { path: "src/a.ts" },
        }),
      },
      {
        kind: "session_update",
        update: toolCallUpdate({
          toolCallId: "call_1",
          status: "completed",
          content: [diff],
        }),
      },
      { kind: "done", stopReason: "end_turn" },
    ])

    // Every ACP update is broadcast verbatim so clients update in place.
    expect(h.broadcasts.map((u) => u.sessionUpdate)).toEqual([
      "tool_call",
      "tool_call_update",
      "tool_call_update",
    ])
    // Exactly one durable tool-call record, merged to its final state — the
    // structured diff content survives as structure, not flattened text.
    expect([...h.toolCalls.values()]).toEqual<AcpToolCallRecord[]>([
      {
        role: "tool_call",
        toolCallId: "call_1",
        title: "edit_file",
        kind: "edit",
        status: "completed",
        content: [diff],
        rawInput: { path: "src/a.ts" },
        rawOutput: undefined,
      },
    ])
    // No spurious agent text record for a tool-only turn.
    expect(h.records).toEqual([])
    expect(h.statusOf()).toBe("completed")
  })

  it("keeps two concurrent tool calls separate, keyed by id", async () => {
    const h = harness()
    await feed(h.consumer, [
      {
        kind: "session_update",
        update: toolCallStart({ toolCallId: "a", title: "read_file" }),
      },
      {
        kind: "session_update",
        update: toolCallStart({ toolCallId: "b", title: "run_command" }),
      },
      {
        kind: "session_update",
        update: toolCallUpdate({ toolCallId: "a", status: "completed" }),
      },
      { kind: "done", stopReason: "end_turn" },
    ])

    expect(h.toolCalls.get("a")?.status).toBe("completed")
    expect(h.toolCalls.get("b")?.status).toBe("pending")
    expect(h.toolCalls.size).toBe(2)
  })

  it("records a tool failure as failed status (distinct from a turn error)", async () => {
    const h = harness()
    await feed(h.consumer, [
      {
        kind: "session_update",
        update: toolCallStart({ toolCallId: "x", title: "run_command" }),
      },
      {
        kind: "session_update",
        update: toolCallUpdate({ toolCallId: "x", status: "failed" }),
      },
      { kind: "done", stopReason: "end_turn" },
    ])

    expect(h.toolCalls.get("x")?.status).toBe("failed")
    // The turn itself still completed — a failed tool is not a failed run.
    expect(h.statusOf()).toBe("completed")
  })
})
