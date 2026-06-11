import { describe, expect, it } from "vitest"
import type { TextStreamPart, Tool } from "ai"

import {
  AcpUpdateConsumer,
  type AcpConsumerPorts,
  type ConsumerPlanCall,
} from "./consumer"
import type { EngineUpdate, Engine } from "./engine-seam"
import type { AcpMessageRecord, AcpToolCallRecord } from "./record"
import {
  AgentSideConnection,
  planPermissionRequest,
  PROTOCOL_VERSION,
  SUBMIT_PLAN_TOOL,
  textBlock,
  type Agent,
  type AnyMessage,
  type InitializeResponse,
  type PromptRequest,
  type PromptResponse,
  type RequestPermissionRequest,
  type SessionUpdate,
  type StopReason,
  type Stream,
} from "./schema"
import { aiSdkChunkToAcpUpdate } from "./adapter"
import type { StreamDriver } from "./in-process-engine"
import type { AcpSessionFactory } from "./acp-engine"
import { AcpSession } from "./session"
import { createRunState, type RunStateRepo, type RunStatus } from "../run-state"

/**
 * The shared Engine seam contract (ADR 0006), extracted so every backing of the
 * seam runs the *same* scenario. Both engines — the in-process AI-SDK translator
 * and the external ACP client — and both ACP transports — a crossed pair of
 * in-memory streams and a real spawned subprocess — must drive the *same* turn
 * to the *same* observable ACP outcome: the same broadcast update sequence, the
 * same persisted ACP-native records, and the same terminal run-state. That is
 * what makes the seam honest rather than nominal and proves the swap targets are
 * interchangeable.
 *
 * Each backing supplies a `makeEngine(driver)` that turns a {@link StreamDriver}
 * scenario into an {@link Engine}; the four scenarios below are identical across
 * all of them.
 */
export function contractFor(
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

      // The model streams a line of narration, then calls `submit_plan` — first
      // the streaming-input opener (`tool-input-start`, as the real AI SDK
      // does), then the resolved `tool-call` — then the turn finishes (the tool
      // has no result, so the loop halts).
      const driver: StreamDriver = (config) => ({
        consumeStream: async () => {
          await config.onChunk?.({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            chunk: { type: "text-delta", id: "t1", text: "My plan:" } as any,
          })
          await config.onChunk?.({
            chunk: {
              type: "tool-input-start",
              id: "toolu_plan_1",
              toolName: "submit_plan",
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
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
          // The approval gate only exists on a plan-mode turn: the real adapter
          // raises its ExitPlanMode permission request solely after
          // `session/set_mode(plan)` (spike #408), so the external engine routes
          // a permission request to the gate only here — every other request is
          // an ordinary tool approval it auto-allows. The in-process engine gates
          // on the `submit_plan` tool-call itself, so this flag is inert for it.
          planMode: true,
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
      // The gate surfaces *only* as the permission request: its streaming-input
      // opener must not leak a `tool_call` chip, which — never completed — would
      // spin forever next to the approval card.
      expect(
        broadcasts.filter(
          (u) =>
            u.sessionUpdate === "tool_call" ||
            u.sessionUpdate === "tool_call_update"
        )
      ).toEqual([])
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

const CONTRACT_SESSION_ID = "sess_contract"

/** Map an AI-SDK `finishReason` to an ACP `stopReason` (as a real agent would). */
export function finishToStopReason(
  finishReason: string | undefined
): StopReason {
  switch (finishReason) {
    case "length":
      return "max_tokens"
    case "content-filter":
      return "refusal"
    default:
      return "end_turn"
  }
}

/** A pair of crossed in-memory streams — the whole transport, no bytes, no process. */
function inMemoryStreams(): { client: Stream; agent: Stream } {
  const toAgent = new TransformStream<AnyMessage, AnyMessage>()
  const toClient = new TransformStream<AnyMessage, AnyMessage>()
  return {
    client: { writable: toAgent.writable, readable: toClient.readable },
    agent: { writable: toClient.writable, readable: toAgent.readable },
  }
}

/**
 * Stand up a generic ACP agent whose turn is scripted by the *same*
 * {@link StreamDriver} the in-process engine consumes, then hand the
 * {@link ExternalEngine} a factory that opens a session to it. The agent emits
 * genuine ACP `session/update`s and raises a real permission request for
 * `submit_plan`, exactly as a conforming agent would — so a single scenario
 * drives both engines to the same observable outcome.
 */
export function acpSessionFactoryFromDriver(
  driver: StreamDriver
): AcpSessionFactory {
  const behavior = async (
    conn: AgentSideConnection,
    params: PromptRequest
  ): Promise<StopReason> => {
    let finishReason: string | undefined
    let cancelled = false
    const result = driver({
      onChunk: async ({
        chunk,
      }: {
        chunk: TextStreamPart<Record<string, Tool>>
      }) => {
        // The plan gate streams its arguments first — a conforming agent does
        // *not* publish that as a `tool_call`, since the gate surfaces only as
        // the permission request below; an emitted pending call would never
        // complete and would spin on screen.
        if (
          chunk.type === "tool-input-start" &&
          chunk.toolName === SUBMIT_PLAN_TOOL
        ) {
          return
        }
        // A `submit_plan` tool-call is screenplay's plan gate — a real ACP agent
        // raises it as an ACP *permission request*, not a `session/update`.
        if (chunk.type === "tool-call" && chunk.toolName === SUBMIT_PLAN_TOOL) {
          const { outcome } = await conn.requestPermission(
            planPermissionRequest({
              sessionId: params.sessionId,
              toolCallId: chunk.toolCallId,
              plan: String(
                (chunk.input as { plan?: unknown } | undefined)?.plan ?? ""
              ),
            })
          )
          if (outcome.outcome === "cancelled") cancelled = true
          return
        }
        const update = aiSdkChunkToAcpUpdate(chunk)
        if (update) {
          await conn.sessionUpdate({ sessionId: params.sessionId, update })
        }
      },
      onFinish: async ({ finishReason: fr }: { finishReason?: string }) => {
        finishReason = fr
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any)

    try {
      await result.consumeStream()
    } catch {
      // An aborted model stream throws (the `/stop` scenario's driver shape); a
      // real ACP agent acknowledges the cancel and resolves the turn `cancelled`.
      return "cancelled"
    }
    // The plan gate was cancelled out from under the agent — it stands down.
    if (cancelled) return "cancelled"
    return finishToStopReason(finishReason)
  }

  return {
    async open(ports, options) {
      const { client, agent: agentStream } = inMemoryStreams()
      const agentConn = new AgentSideConnection(
        (conn) => new DriverAgent(conn, behavior),
        agentStream
      )
      // `agentConn` keeps the agent's receive loop alive for the session.
      void agentConn
      return AcpSession.open(client, ports, options)
    },
  }
}

/** A minimal ACP-conforming agent whose `prompt` defers to a scripted behavior. */
class DriverAgent implements Agent {
  constructor(
    private readonly conn: AgentSideConnection,
    private readonly behavior: (
      conn: AgentSideConnection,
      params: PromptRequest
    ) => Promise<StopReason>
  ) {}
  async initialize(): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: { loadSession: true },
    }
  }
  async newSession(): Promise<{ sessionId: string }> {
    return { sessionId: CONTRACT_SESSION_ID }
  }
  async authenticate(): Promise<void> {}
  async loadSession(): Promise<Record<string, never>> {
    return {}
  }
  async prompt(params: PromptRequest): Promise<PromptResponse> {
    return { stopReason: await this.behavior(this.conn, params) }
  }
  async cancel(): Promise<void> {}
}

/**
 * An ACP instruction script captured from a {@link StreamDriver} scenario: the
 * exact ACP a conforming agent would emit, serialized so a *real subprocess*
 * fake agent can replay it over stdio (see `fake-acp-agent.mjs`). This is the
 * same AI-SDK-chunk → ACP translation {@link acpSessionFactoryFromDriver} does
 * inline; capturing it as data is what lets the identical scenario cross a
 * process boundary.
 */
export interface AcpScript {
  /** Ordered ACP emissions: a `session/update` or a plan permission request. */
  instructions: Array<
    | { kind: "update"; update: SessionUpdate }
    | { kind: "permission"; toolCallId: string; plan: string }
  >
  /** The turn's terminal `stopReason` (when it finished rather than threw). */
  stopReason: StopReason
  /** The driver threw mid-stream — the `/stop` shape; resolve as `cancelled`. */
  threw: boolean
}

/**
 * Run a {@link StreamDriver} scenario and capture the ACP it would produce as a
 * serializable {@link AcpScript}, mirroring {@link acpSessionFactoryFromDriver}'s
 * per-chunk translation (suppress the plan-gate input opener, turn a
 * `submit_plan` call into a permission instruction, translate the rest with
 * {@link aiSdkChunkToAcpUpdate}). The result drives the subprocess fake agent.
 */
export async function captureAcpScript(
  driver: StreamDriver
): Promise<AcpScript> {
  const instructions: AcpScript["instructions"] = []
  let finishReason: string | undefined
  let threw = false

  const result = driver({
    onChunk: async ({
      chunk,
    }: {
      chunk: TextStreamPart<Record<string, Tool>>
    }) => {
      if (
        chunk.type === "tool-input-start" &&
        chunk.toolName === SUBMIT_PLAN_TOOL
      ) {
        return
      }
      if (chunk.type === "tool-call" && chunk.toolName === SUBMIT_PLAN_TOOL) {
        instructions.push({
          kind: "permission",
          toolCallId: chunk.toolCallId,
          plan: String(
            (chunk.input as { plan?: unknown } | undefined)?.plan ?? ""
          ),
        })
        return
      }
      const update = aiSdkChunkToAcpUpdate(chunk)
      if (update) instructions.push({ kind: "update", update })
    },
    onFinish: async ({ finishReason: fr }: { finishReason?: string }) => {
      finishReason = fr
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)

  try {
    await result.consumeStream()
  } catch {
    threw = true
  }

  return { instructions, stopReason: finishToStopReason(finishReason), threw }
}
