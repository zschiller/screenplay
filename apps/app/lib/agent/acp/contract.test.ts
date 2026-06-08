import { describe, expect, it, vi } from "vitest"

// The in-process engine binds to the model providers at import time; none of
// that is exercised here — every test injects a fake stream driver — so stub
// the provider resolution that would otherwise demand real API keys.
vi.mock("@/lib/agent/providers", () => ({
  resolveLanguageModel: () => ({}),
}))

import { AcpUpdateConsumer, type AcpConsumerPorts } from "./consumer"
import type { EngineUpdate, Engine } from "./engine-seam"
import type { AcpMessageRecord } from "./record"
import { textBlock, type SessionUpdate } from "./schema"
import { InProcessAiSdkEngine, type StreamDriver } from "./in-process-engine"

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
        async transition(to) {
          if (to === "completed") completed = true
        },
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

    // Weighted heavily once the ACP engine lands (PRD design goal 1).
    it.todo("plan-mode permission request maps to the approval gate")
    it.todo(
      "/stop cancels the in-flight turn and reports a stop, not a failure"
    )
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
