import { describe, expect, it, vi } from "vitest"

// The in-process engine binds to the model providers at import time; none of
// that is exercised here — every test injects a fake stream driver — so stub
// the provider resolution that would otherwise demand real API keys.
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
}))
// `run-state` binds to the live Drizzle handle at import time; the `/stop`
// contract drives a real `createRunState` over an in-memory repo, so stub the
// db boundary that would otherwise demand a real DATABASE_URL (mirrors
// consumer.test.ts).
vi.mock("@/lib/db", () => ({ db: {} }))

import {
  AcpUpdateConsumer,
  type AcpConsumerPorts,
  type ConsumerPlanCall,
} from "./consumer"
import type { EngineUpdate, Engine } from "./engine-seam"
import type { AcpMessageRecord, AcpToolCallRecord } from "./record"
import {
  textBlock,
  type RequestPermissionRequest,
  type SessionUpdate,
} from "./schema"
import { InProcessAiSdkEngine, type StreamDriver } from "./in-process-engine"
import { createRunState, type RunStateRepo, type RunStatus } from "../run-state"

/**
 * The shared Engine seam contract (ADR 0006). Both engines — the in-process
 * AI-SDK translator and a future real ACP client — must drive the *same* turn
 * to the *same* observable ACP outcome: the same broadcast update sequence, the
 * same persisted ACP-native records, and the same terminal run-state. This is
 * what makes the seam honest rather than nominal and proves the swap target is
 * compatible.
 *
 * For the first tracer bullet only the **text path** must pass. The plan-mode
 * and `/stop` mappings (weighted heavily once the ACP engine lands) are marked
 * `todo` so the skeleton is visible but unfulfilled.
 */
function contractFor(
  name: string,
  makeEngine: (driver: StreamDriver) => Engine
) {
  describe(`Engine contract: ${name}`, () => {
    it("a plain streamed text turn yields agent_message_chunks, an ACP-native record, completion, and stream end", async () => {
      // The engine reports its updates; the consumer turns them into the
      // observable outcome we assert on.
      const broadcasts: SessionUpdate[] = []
      const records: AcpMessageRecord[] = []
      let completed = false
      let ended = false
      const ports: AcpConsumerPorts = {
        async broadcastUpdate(u) {
          broadcasts.push(u)
        },
        async broadcastError() {},
        async broadcastEnd() {
          ended = true
        },
        async appendRecord(r) {
          records.push(r)
        },
        async upsertToolCall() {},
        async transition(to) {
          if (to === "completed") completed = true
        },
        async broadcastPermissionRequest() {},
        async pauseForPlan() {},
      }
      const consumer = new AcpUpdateConsumer(ports)

      // A driver that streams two text deltas then finishes cleanly.
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
          await config.onFinish?.({
            finishReason: "stop",
            totalUsage: {
              inputTokens: 12,
              outputTokens: 3,
              inputTokenDetails: { cacheReadTokens: 10, cacheWriteTokens: 2 },
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
        },
      })

      const engine = makeEngine(driver)
      const sink = (u: EngineUpdate) => consumer.handle(u)
      await engine.run(
        {
          chatId: "chat_1",
          runId: "run_1",
          roomId: "room_1",
          systemPrompt: "sys",
          model: "anthropic:test",
          history: [{ role: "user", content: [textBlock("hi")] }],
        },
        sink,
        new AbortController().signal
      )

      // Observable ACP outcome — independent of which engine produced it.
      expect(broadcasts).toEqual([
        { sessionUpdate: "agent_message_chunk", content: textBlock("Hel") },
        { sessionUpdate: "agent_message_chunk", content: textBlock("lo") },
      ])
      expect(records).toEqual<AcpMessageRecord[]>([
        { role: "agent", content: [textBlock("Hello")] },
      ])
      expect(completed).toBe(true)
      expect(ended).toBe(true)
    })

    // Weighted heavily for the swap to a real ACP client (PRD design goal 1):
    // a `submit_plan` call must surface as an ACP *permission request* that maps
    // onto the approval-gate pause — never a completion, never the informational
    // `plan` update.
    it("plan-mode permission request maps to the approval gate", async () => {
      const broadcasts: SessionUpdate[] = []
      const permissionRequests: RequestPermissionRequest[] = []
      const records: AcpMessageRecord[] = []
      const pausedCalls: ConsumerPlanCall[] = []
      let completed = false
      let ended = false
      const ports: AcpConsumerPorts = {
        async broadcastUpdate(u) {
          broadcasts.push(u)
        },
        async broadcastError() {},
        async broadcastEnd() {
          ended = true
        },
        async appendRecord(r) {
          records.push(r)
        },
        async upsertToolCall() {},
        async transition(to) {
          if (to === "completed") completed = true
        },
        async broadcastPermissionRequest(r) {
          permissionRequests.push(r)
        },
        async pauseForPlan(c) {
          pausedCalls.push(c)
        },
      }
      const consumer = new AcpUpdateConsumer(ports)

      // The model streams a line of narration, then calls `submit_plan`, then
      // the turn finishes (the tool has no result, so the loop halts).
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

      const engine = makeEngine(driver)
      await engine.run(
        {
          chatId: "chat_1",
          runId: "run_1",
          roomId: "room_1",
          systemPrompt: "sys",
          model: "anthropic:test",
          history: [{ role: "user", content: [textBlock("plan it")] }],
        },
        (u: EngineUpdate) => consumer.handle(u),
        new AbortController().signal
      )

      // Observable ACP outcome: an approval gate, not a completion.
      expect(permissionRequests).toHaveLength(1)
      expect(permissionRequests[0]!.options.map((o) => o.optionId)).toEqual([
        "approve",
        "reject",
      ])
      expect(pausedCalls).toEqual<ConsumerPlanCall[]>([
        {
          toolCallId: "toolu_plan_1",
          toolName: "submit_plan",
          input: { plan: "1. ship it" },
        },
      ])
      // Pre-plan narration persists; the run pauses rather than completing.
      expect(records).toEqual<AcpMessageRecord[]>([
        { role: "agent", content: [textBlock("My plan:")] },
      ])
      expect(completed).toBe(false)
      expect(ended).toBe(true)
    })

    it("a tool call advances pending → in_progress → completed keyed by id, persisted in place", async () => {
      const broadcasts: SessionUpdate[] = []
      const toolCalls = new Map<string, AcpToolCallRecord>()
      const ports: AcpConsumerPorts = {
        async broadcastUpdate(u) {
          broadcasts.push(u)
        },
        async broadcastError() {},
        async broadcastEnd() {},
        async appendRecord() {},
        async upsertToolCall(r) {
          toolCalls.set(r.toolCallId, r)
        },
        async transition() {},
        async broadcastPermissionRequest() {},
        async pauseForPlan() {},
      }
      const consumer = new AcpUpdateConsumer(ports)

      // A driver that streams a tool through input-start → call → result.
      const driver: StreamDriver = (config) => ({
        consumeStream: async () => {
          await config.onChunk?.({
            chunk: {
              type: "tool-input-start",
              id: "call_1",
              toolName: "read_file",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          })
          await config.onChunk?.({
            chunk: {
              type: "tool-call",
              toolCallId: "call_1",
              toolName: "read_file",
              input: { path: "a.ts" },
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          })
          await config.onChunk?.({
            chunk: {
              type: "tool-result",
              toolCallId: "call_1",
              toolName: "read_file",
              output: "file contents",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          })
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          await config.onFinish?.({ finishReason: "stop" } as any)
        },
      })

      const engine = makeEngine(driver)
      await engine.run(
        {
          chatId: "c",
          runId: "r",
          roomId: "rm",
          systemPrompt: "s",
          model: "anthropic:test",
          history: [],
        },
        (u: EngineUpdate) => consumer.handle(u),
        new AbortController().signal
      )

      // The engine emits ACP tool-call + tool-call updates with the lifecycle.
      expect(
        broadcasts.map((u) => [
          u.sessionUpdate,
          "status" in u ? u.status : undefined,
        ])
      ).toEqual([
        ["tool_call", "pending"],
        ["tool_call_update", "in_progress"],
        ["tool_call_update", "completed"],
      ])
      // One record, merged in place, with structured content (not flattened).
      const record = toolCalls.get("call_1")
      expect(record?.status).toBe("completed")
      expect(record?.kind).toBe("read")
      expect(record?.rawInput).toEqual({ path: "a.ts" })
      expect(record?.content).toEqual([
        { type: "content", content: { type: "text", text: "file contents" } },
      ])
    })

    // Weighted heavily for the swap to a real ACP client (PRD #375): a `/stop`
    // (or a supersession) aborts the in-flight turn and reports the terminal
    // outcome as a **stop**, never a `failed` run. The run lifecycle's watchdog
    // has already moved the run to its terminal stop state (`aborted`/
    // `superseded`) by the time the abort surfaces, so the consumer's `failed`
    // transition must no-op and "Stopped by user" must surface — kept distinct
    // from a genuine error, which *does* record `failed`.
    it("/stop cancels the in-flight turn and reports a stop, not a failure", async () => {
      const broadcasts: SessionUpdate[] = []
      const errors: string[] = []
      const records: AcpMessageRecord[] = []
      let ended = false

      // A real run-state over an in-memory row seeded `aborted`, exactly as the
      // watchdog would have left it when it tripped the signal — so the genuine
      // terminal-no-op guard decides the outcome, not a permissive fake.
      const rows = new Map<string, RunStatus>([["run_1", "aborted"]])
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
        async pauseForPlan() {},
        async resolvePlan() {
          return null
        },
      }
      const runState = createRunState(repo)

      const ports: AcpConsumerPorts = {
        async broadcastUpdate(u) {
          broadcasts.push(u)
        },
        async broadcastError(m) {
          errors.push(m)
        },
        async broadcastEnd() {
          ended = true
        },
        async appendRecord(r) {
          records.push(r)
        },
        async upsertToolCall() {},
        async transition(to) {
          await runState.transition("run_1", to)
        },
        async broadcastPermissionRequest() {},
        async pauseForPlan() {},
      }
      const consumer = new AcpUpdateConsumer(ports)

      // A driver that throws once the stream is drained — the shape an aborted
      // model stream takes (matches the in-process engine's cancellation test).
      const driver: StreamDriver = () => ({
        consumeStream: async () => {
          throw new Error("aborted")
        },
      })
      const controller = new AbortController()
      controller.abort()

      const engine = makeEngine(driver)
      await engine.run(
        {
          chatId: "chat_1",
          runId: "run_1",
          roomId: "room_1",
          systemPrompt: "sys",
          model: "anthropic:test",
          history: [{ role: "user", content: [textBlock("hi")] }],
        },
        (u: EngineUpdate) => consumer.handle(u),
        controller.signal
      )

      // Observable ACP outcome: a stop, not a failure.
      expect(errors).toEqual(["Stopped by user"])
      expect(rows.get("run_1")).toBe("aborted") // the `failed` transition no-ops
      expect(records).toEqual([]) // nothing durable persisted on a stop
      expect(ended).toBe(true)
    })
  })
}

contractFor("in-process AI-SDK", (driver) => new InProcessAiSdkEngine(driver))

// The real ACP engine plugs into the same contract in a later slice:
//   contractFor("acp", (driver) => new AcpEngine(...))

describe("InProcessAiSdkEngine — capability + cancellation", () => {
  it("captures prompt-cache usage from onFinish", async () => {
    const driver: StreamDriver = (config) => ({
      consumeStream: async () => {
        await config.onFinish?.({
          finishReason: "stop",
          totalUsage: {
            inputTokens: 100,
            outputTokens: 20,
            inputTokenDetails: { cacheReadTokens: 90, cacheWriteTokens: 10 },
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any)
      },
    })
    const engine = new InProcessAiSdkEngine(driver)
    await engine.run(
      {
        chatId: "c",
        runId: "r",
        roomId: "rm",
        systemPrompt: "s",
        model: "anthropic:test",
        history: [],
      },
      () => {},
      new AbortController().signal
    )
    expect(engine.lastTurnUsage()).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 90,
      cacheWriteTokens: 10,
    })
  })

  it("reports an aborted run as a stop, not a failure", async () => {
    const updates: EngineUpdate[] = []
    const driver: StreamDriver = () => ({
      consumeStream: async () => {
        throw new Error("aborted")
      },
    })
    const controller = new AbortController()
    controller.abort()
    const engine = new InProcessAiSdkEngine(driver)
    await engine.run(
      {
        chatId: "c",
        runId: "r",
        roomId: "rm",
        systemPrompt: "s",
        model: "anthropic:test",
        history: [],
      },
      (u) => {
        updates.push(u)
      },
      controller.signal
    )
    expect(updates).toEqual([{ kind: "error", message: "Stopped by user" }])
  })
})
