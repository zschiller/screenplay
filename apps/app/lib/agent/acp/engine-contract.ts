import { describe, expect, it } from "vitest"
import type { ModelMessage, TextStreamPart, Tool } from "ai"

import {
  AcpUpdateConsumer,
  type AcpConsumerPorts,
  type ConsumerPlanCall,
} from "./consumer"
import { type EngineUpdate, type Engine, type TakenSteer } from "./engine-seam"
import type { AcpMessageRecord, AcpToolCallRecord } from "./record"
import {
  AgentSideConnection,
  planPermissionRequest,
  PROTOCOL_VERSION,
  SUBMIT_PLAN_TOOL,
  textBlock,
  type Agent,
  type AnyMessage,
  type ContentBlock,
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
import { driveEngineTurn } from "./live-turn"
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
        async settleSteers() {},
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
        async settleSteers() {},
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
        async settleSteers() {},
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
    // `superseded`) by the time the abort surfaces, so the Engine reports a
    // clean cancellation: no error, the run keeps its stop status — kept
    // distinct from a genuine error, which *does* record `failed` (#909).
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
        async settleSteers() {},
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
      expect(errors).toEqual([]) // a stop is not an error
      expect(rows.get("run_1")).toBe("aborted")
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
function inMemoryStreams(): {
  client: Stream
  agent: Stream
  /** End the client's side, as an agent process exiting does. */
  exit(): void
} {
  const toAgent = new TransformStream<AnyMessage, AnyMessage>()
  const toClient = new TransformStream<AnyMessage, AnyMessage>()
  const exited = new AbortController()
  const readable = toClient.readable.pipeThrough(
    new TransformStream<AnyMessage, AnyMessage>(),
    { signal: exited.signal }
  )
  return {
    client: { writable: toAgent.writable, readable },
    agent: { writable: toClient.writable, readable: toAgent.readable },
    exit: () => exited.abort(new Error("agent exited")),
  }
}

/**
 * Stand up a generic ACP agent whose turn is scripted by the *same*
 * {@link StreamDriver} the in-process engine consumes, then hand the
 * {@link ExternalEngine} a factory that opens a session to it. The agent emits
 * genuine ACP `session/update`s and raises a real permission request for
 * `submit_plan`, exactly as a conforming agent would — so a single scenario
 * drives both engines to the same observable outcome.
 *
 * With `promptQueueing` the agent also does what the Claude adapter does
 * (#1191): it advertises `_meta.claudeCode.promptQueueing`, and a prompt sent
 * while one runs joins the running turn at its next step, where the model reads
 * it as the newest user message. The earlier prompt resolves `end_turn` at that
 * handoff; a prompt the turn finished before reading starts another pass.
 *
 * With `steering` it does what Codex's adapter does instead (#1192): it
 * advertises `_meta.steering.supported` and takes a mid-turn message through
 * `_session/steering`. A message sent while a turn runs joins it at its next
 * step (`injected`) without a prompt of its own; one sent between turns starts
 * a turn nobody's prompt waits on (`startedNewTurn`), reported through the
 * thread status `session_info_update`s every turn carries. `failures` answers
 * that many requests `failed` first.
 */
export function acpSessionFactoryFromDriver(
  driver: StreamDriver,
  options: { promptQueueing?: boolean; steering?: { failures?: number } } = {}
): AcpSessionFactory {
  return {
    async open(ports, openOptions) {
      const { client, agent: agentStream, exit } = inMemoryStreams()
      const agentConn = new AgentSideConnection(
        (conn) =>
          new DriverAgent(
            conn,
            driver,
            options.promptQueueing ?? false,
            options.steering
          ),
        agentStream
      )
      // `agentConn` keeps the agent's receive loop alive for the session.
      void agentConn
      const session = await AcpSession.open(client, ports, openOptions)
      session.onClose(exit)
      return session
    },
  }
}

/** A prompt the {@link DriverAgent} was sent, until it resolves. */
interface DriverPrompt {
  text: string
  resolve(stopReason: StopReason): void
}

/**
 * A minimal ACP-conforming agent whose turns the scripted {@link StreamDriver}
 * plays, one `streamText`-like pass per turn over the conversation so far.
 */
class DriverAgent implements Agent {
  private readonly conversation: ModelMessage[] = []
  /** Prompts sent while a pass runs, waiting for its next step. */
  private queued: DriverPrompt[] = []
  private active: DriverPrompt | null = null
  private abort = new AbortController()
  /** Steering requests still to answer `failed`. */
  private failures: number

  constructor(
    private readonly conn: AgentSideConnection,
    private readonly driver: StreamDriver,
    private readonly promptQueueing: boolean,
    private readonly steering?: { failures?: number }
  ) {
    this.failures = steering?.failures ?? 0
  }
  async initialize(): Promise<InitializeResponse> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities: {
        loadSession: true,
        ...(this.promptQueueing
          ? { _meta: { claudeCode: { promptQueueing: true } } }
          : {}),
      },
      ...(this.steering ? { _meta: { steering: { supported: true } } } : {}),
    }
  }
  /** Codex's `_session/steering`: join the running turn, or start one. */
  async extMethod(
    method: string,
    params: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    if (method !== "_session/steering" || !this.steering) {
      throw new Error(`unknown method ${method}`)
    }
    if (this.failures > 0) {
      this.failures--
      return { outcome: "failed" }
    }
    const blocks = params.prompt as ContentBlock[]
    const steer: DriverPrompt = {
      text: blocks.map((b) => ("text" in b ? b.text : "")).join(""),
      resolve: () => {},
    }
    if (this.active) {
      this.queued.push(steer)
      return { outcome: "injected" }
    }
    this.active = steer
    this.conversation.push({ role: "user", content: steer.text })
    void this.play(params.sessionId as string)
    return { outcome: "startedNewTurn" }
  }
  async newSession(): Promise<{ sessionId: string }> {
    return { sessionId: CONTRACT_SESSION_ID }
  }
  async authenticate(): Promise<void> {}
  async loadSession(): Promise<Record<string, never>> {
    return {}
  }
  prompt(params: PromptRequest): Promise<PromptResponse> {
    return new Promise((resolve) => {
      const prompt: DriverPrompt = {
        text: params.prompt.map((b) => ("text" in b ? b.text : "")).join(""),
        resolve: (stopReason) => resolve({ stopReason }),
      }
      if (this.active && this.promptQueueing) {
        this.queued.push(prompt)
        return
      }
      this.active = prompt
      this.conversation.push({ role: "user", content: prompt.text })
      void this.play(params.sessionId)
    })
  }
  async cancel(): Promise<void> {
    this.abort.abort()
  }

  /**
   * Play passes until the turn is over: the active prompt's pass, then one per
   * batch of prompts that arrived after its last step.
   */
  private async play(sessionId: string): Promise<void> {
    await this.threadStatus(sessionId, "active")
    for (;;) {
      this.abort = new AbortController()
      const outcome = await this.pass(sessionId)
      if (outcome === "cancelled") {
        const prompts = [this.active!, ...this.queued]
        this.queued = []
        this.active = null
        await this.threadStatus(sessionId, "idle")
        for (const prompt of prompts) prompt.resolve("cancelled")
        return
      }
      if (this.queued.length === 0) {
        const prompt = this.active!
        this.active = null
        await this.threadStatus(sessionId, "idle")
        prompt.resolve(outcome)
        return
      }
      this.conversation.push(this.handOff())
    }
  }

  /** Report the thread's status the way Codex's adapter does, when steering. */
  private async threadStatus(
    sessionId: string,
    type: "active" | "idle"
  ): Promise<void> {
    if (!this.steering) return
    await this.conn.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: "session_info_update",
        _meta: { codex: { threadStatus: { type } } },
      },
    })
  }

  /**
   * Hand the turn over to the queued prompts, oldest first: they reach the
   * model together as one user message. With prompt queueing each earlier
   * prompt resolves `end_turn`; a steered message has no prompt, so the turn's
   * own prompt stays the one that resolves.
   */
  private handOff(): ModelMessage {
    const next = this.queued
    this.queued = []
    if (!this.steering) {
      this.active!.resolve("end_turn")
      for (const prompt of next.slice(0, -1)) prompt.resolve("end_turn")
      this.active = next.at(-1)!
    }
    return { role: "user", content: next.map((p) => p.text).join("\n\n") }
  }

  /** One pass of the driver over the conversation, with steps that read queued prompts. */
  private async pass(sessionId: string): Promise<StopReason> {
    let finishReason: string | undefined
    let responses: ModelMessage[] = []
    let gateCancelled = false
    // Prompts read at a step, each at the index of the step input it follows.
    const read: Array<{ at: number; message: ModelMessage }> = []
    const result = this.driver({
      messages: [...this.conversation],
      abortSignal: this.abort.signal,
      prepareStep: async ({ messages }: { messages: ModelMessage[] }) => {
        // Let prompts the client sent after the last update arrive first.
        await new Promise((resolve) => setTimeout(resolve, 0))
        if (this.queued.length > 0) {
          read.push({ at: messages.length, message: this.handOff() })
        }
        return read.length > 0 ? { messages: withRead(messages, read) } : {}
      },
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
          const { outcome } = await this.conn.requestPermission(
            planPermissionRequest({
              sessionId,
              toolCallId: chunk.toolCallId,
              plan: String(
                (chunk.input as { plan?: unknown } | undefined)?.plan ?? ""
              ),
            })
          )
          if (outcome.outcome === "cancelled") gateCancelled = true
          return
        }
        const update = aiSdkChunkToAcpUpdate(chunk)
        if (update) await this.conn.sessionUpdate({ sessionId, update })
      },
      onFinish: async ({
        finishReason: fr,
        response,
      }: {
        finishReason?: string
        response?: { messages: ModelMessage[] }
      }) => {
        finishReason = fr
        responses = response?.messages ?? []
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
    if (gateCancelled) return "cancelled"
    const conversation = withRead([...this.conversation, ...responses], read)
    this.conversation.splice(0, this.conversation.length, ...conversation)
    return finishToStopReason(finishReason)
  }
}

/** Put the prompts a pass read back into its messages where it read them. */
function withRead(
  messages: ModelMessage[],
  read: Array<{ at: number; message: ModelMessage }>
): ModelMessage[] {
  const out = [...messages]
  for (const { at, message } of [...read].reverse()) {
    out.splice(at, 0, message)
  }
  return out
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

/**
 * One model step a {@link steppedDriver} plays: its stream chunks, with test
 * hooks run between them (a Steer arriving mid-tool-call), and the response
 * messages the step adds to the conversation.
 */
export interface ScriptedStep {
  chunks: Array<
    TextStreamPart<Record<string, Tool>> | (() => void | Promise<void>)
  >
  response: ModelMessage[]
}

/**
 * A {@link StreamDriver} that plays the AI SDK's multi-step loop faithfully
 * enough for steering: before each step it calls `prepareStep` with the pass's
 * messages plus every earlier step's responses, and records what the model
 * was sent (the override, when `prepareStep` returns one). Each `streamText`
 * call plays the next pass. A step that finds the signal aborted throws, as
 * the SDK does.
 */
export function steppedDriver(
  passes: ScriptedStep[][],
  sent: ModelMessage[][]
): StreamDriver {
  let pass = 0
  return (config) => ({
    consumeStream: async () => {
      const steps = passes[pass++] ?? []
      const responses: ModelMessage[] = []
      for (const [stepNumber, step] of steps.entries()) {
        const input = [...(config.messages ?? []), ...responses]
        const prepared = await config.prepareStep?.({
          stepNumber,
          steps: [],
          messages: input,
          model: config.model,
          experimental_context: undefined,
        })
        if (config.abortSignal?.aborted) throw new Error("aborted")
        sent.push(prepared?.messages ?? input)
        for (const chunk of step.chunks) {
          if (typeof chunk === "function") await chunk()
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          else await config.onChunk?.({ chunk: chunk as any })
        }
        if (config.abortSignal?.aborted) throw new Error("aborted")
        responses.push(...step.response)
      }
      await config.onFinish?.({
        finishReason: "stop",
        totalUsage: {},
        response: { messages: responses },
        steps: steps.map(() => ({})),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any)
    },
  })
}

// Scripted pieces of a step, loosely typed like the scenarios above.
/* eslint-disable @typescript-eslint/no-explicit-any */
const toolCallChunks = (id: string, name: string) => ({
  start: { type: "tool-input-start", id, toolName: name } as any,
  call: {
    type: "tool-call",
    toolCallId: id,
    toolName: name,
    input: { path: "a.ts" },
  } as any,
  result: {
    type: "tool-result",
    toolCallId: id,
    toolName: name,
    output: "file contents",
  } as any,
})
const textChunk = (text: string) =>
  ({ type: "text-delta", id: "t", text }) as any
/* eslint-enable @typescript-eslint/no-explicit-any */
const toolResponse = (id: string): ModelMessage[] => [
  {
    role: "assistant",
    content: [
      { type: "tool-call", toolCallId: id, toolName: "read_file", input: {} },
    ],
  },
  {
    role: "tool",
    content: [
      {
        type: "tool-result",
        toolCallId: id,
        toolName: "read_file",
        output: { type: "text", value: "file contents" },
      },
    ],
  },
]
const textResponse = (text: string): ModelMessage[] => [
  { role: "assistant", content: text },
]

/**
 * The steering contract (#1190), run against every Engine that can steer. It
 * drives a turn while Steers arrive, through the same consumer the live route
 * uses, and asserts what a client and a reload observe: the Steers are taken
 * at the next step boundary, oldest first and together, land in the log where
 * they were taken, reach the model before its next step, and never after a
 * stop.
 */
export function steeringContractFor(
  name: string,
  makeEngine: (driver: StreamDriver) => Engine
) {
  describe(`Engine steering contract: ${name}`, () => {
    /** One turn over an in-memory inbox, the consumer and a scripted model. */
    function steeringTurn(passes: ScriptedStep[][]) {
      // The durable log in order: records as appended, tool calls where they
      // were first seen, the way the history route orders them.
      const log: string[] = []
      const seenCalls = new Set<string>()
      const updates: EngineUpdate[] = []
      const transitions: RunStatus[] = []
      const inbox: Array<{ id: string; text: string }> = []
      const taken: string[][] = []
      const reports: boolean[] = []
      const sent: ModelMessage[][] = []
      const controller = new AbortController()
      const ports: AcpConsumerPorts = {
        async broadcastUpdate() {},
        async broadcastError() {},
        async broadcastEnd() {},
        async appendRecord(r) {
          if (r.role !== "tool_call")
            log.push(
              `${r.role}: ${r.content.map((b) => ("text" in b ? b.text : "")).join("")}`
            )
        },
        async upsertToolCall(r) {
          if (seenCalls.has(r.toolCallId)) return
          seenCalls.add(r.toolCallId)
          log.push(`tool_call: ${r.toolCallId}`)
        },
        async transition(to) {
          transitions.push(to)
        },
        async broadcastPermissionRequest() {},
        async pauseForPlan() {},
        async settleSteers(steers) {
          for (const steer of steers) {
            log.push(
              `user: ${steer.content.map((b) => ("text" in b ? b.text : "")).join("")}`
            )
          }
        },
      }
      const consumer = new AcpUpdateConsumer(ports)
      const engine = makeEngine(steppedDriver(passes, sent))
      const run = () =>
        engine.run(
          {
            chatId: "chat_1",
            runId: "run_1",
            roomId: "room_1",
            systemPrompt: "sys",
            model: "anthropic:test",
            history: [{ role: "user", content: [textBlock("fix the bug")] }],
            // What the live route does: take, settle, hand over. With
            // `deliver`, a Steer settles once the agent took it, and the first
            // it didn't goes back to the inbox with the rest.
            takeSteers: async (deliver) => {
              const pending = inbox.splice(0)
              const steers: TakenSteer[] = pending.map((s) => ({
                id: s.id,
                content: [textBlock(s.text)],
              }))
              if (!deliver) {
                if (steers.length > 0) taken.push(steers.map((s) => s.id))
                await consumer.acceptSteers(steers)
                return steers
              }
              const delivered: TakenSteer[] = []
              for (const [index, steer] of steers.entries()) {
                if (!(await deliver(steer))) {
                  inbox.unshift(...pending.slice(index))
                  break
                }
                await consumer.acceptSteers([steer])
                delivered.push(steer)
              }
              if (delivered.length > 0) taken.push(delivered.map((s) => s.id))
              return delivered
            },
            reportSteering: async (steers) => {
              reports.push(steers)
            },
          },
          (u) => {
            updates.push(u)
            return consumer.handle(u)
          },
          controller.signal
        )
      let seq = 0
      const steer = (text: string) => () => {
        inbox.push({ id: `steer_${++seq}`, text })
      }
      return {
        engine,
        run,
        steer,
        log,
        inbox,
        taken,
        reports,
        sent,
        updates,
        transitions,
        controller,
      }
    }

    const lastUserText = (messages: ModelMessage[]) => {
      const last = messages[messages.length - 1]
      return last?.role === "user" ? last.content : undefined
    }

    it("says once, as its session opens, that the run takes Steers", async () => {
      const t = steeringTurn([
        [{ chunks: [textChunk("Hi.")], response: textResponse("Hi.") }],
      ])
      await t.run()
      expect(t.reports).toEqual([true])
    })

    it("takes a Steer sent mid-tool-call at the next step boundary, logs it after that call, and carries on with it", async () => {
      const read = toolCallChunks("call_1", "read_file")
      let steer = () => {}
      const t = steeringTurn([
        [
          {
            chunks: [read.start, read.call, () => steer(), read.result],
            response: toolResponse("call_1"),
          },
          {
            chunks: [textChunk("Done, tests too.")],
            response: textResponse("Done, tests too."),
          },
        ],
      ])
      steer = t.steer("also run the tests")
      await t.run()

      // The model's next step read it, as the conversation's newest message.
      expect(lastUserText(t.sent[1]!)).toBe("also run the tests")
      // It sits where the agent took it: after the tool call, before the
      // reply it steered.
      expect(t.log).toEqual([
        "tool_call: call_1",
        "user: also run the tests",
        "agent: Done, tests too.",
      ])
      expect(t.inbox).toEqual([])
      expect(t.transitions).toEqual(["completed"])
      expect(t.updates.filter((u) => u.kind === "done")).toHaveLength(1)
    })

    it("takes several waiting Steers together, oldest first, as one message", async () => {
      const read = toolCallChunks("call_1", "read_file")
      let first = () => {}
      let second = () => {}
      const t = steeringTurn([
        [
          {
            chunks: [
              read.start,
              read.call,
              () => first(),
              () => second(),
              read.result,
            ],
            response: toolResponse("call_1"),
          },
          { chunks: [textChunk("Ok.")], response: textResponse("Ok.") },
        ],
      ])
      first = t.steer("use the v2 API")
      second = t.steer("and keep the old one working")
      await t.run()

      expect(t.taken).toEqual([["steer_1", "steer_2"]])
      expect(lastUserText(t.sent[1]!)).toBe(
        "use the v2 API\n\nand keep the old one working"
      )
      expect(t.log).toEqual([
        "tool_call: call_1",
        "user: use the v2 API",
        "user: and keep the old one working",
        "agent: Ok.",
      ])
    })

    it("keeps a turn that would finish going when a Steer is waiting", async () => {
      let steer = () => {}
      const t = steeringTurn([
        [
          {
            chunks: [textChunk("Renamed it."), () => steer()],
            response: textResponse("Renamed it."),
          },
        ],
        [
          {
            chunks: [textChunk("Updated the docs.")],
            response: textResponse("Updated the docs."),
          },
        ],
      ])
      steer = t.steer("update the docs too")
      await t.run()

      // The next pass continues the same conversation with the Steer last.
      expect(t.sent).toHaveLength(2)
      expect(t.sent[1]!.slice(-2)).toEqual([
        { role: "assistant", content: "Renamed it." },
        { role: "user", content: "update the docs too" },
      ])
      expect(t.log).toEqual([
        "agent: Renamed it.",
        "user: update the docs too",
        "agent: Updated the docs.",
      ])
      // Still one turn: one completion, one end.
      expect(t.transitions).toEqual(["completed"])
      expect(t.updates.filter((u) => u.kind === "done")).toHaveLength(1)
    })

    it("a Steer that arrives after the last step starts nothing inside the run", async () => {
      const t = steeringTurn([
        [
          {
            chunks: [textChunk("All done.")],
            response: textResponse("All done."),
          },
        ],
      ])
      await t.run()
      t.steer("one more thing")()

      expect(t.inbox).toHaveLength(1)
      expect(t.taken).toEqual([])
      expect(t.sent).toHaveLength(1)
      expect(t.log).toEqual(["agent: All done."])
    })

    it("/stop with a pending Steer leaves it untaken", async () => {
      const read = toolCallChunks("call_1", "read_file")
      let stopWithSteer = () => {}
      const t = steeringTurn([
        [
          {
            chunks: [read.start, read.call, () => stopWithSteer(), read.result],
            response: toolResponse("call_1"),
          },
          { chunks: [textChunk("never")], response: textResponse("never") },
        ],
      ])
      stopWithSteer = () => {
        t.steer("actually, wait")()
        t.controller.abort()
      }
      await t.run()

      expect(t.inbox).toEqual([{ id: "steer_1", text: "actually, wait" }])
      expect(t.taken).toEqual([])
      expect(t.log).toEqual(["tool_call: call_1"])
      expect(t.updates.at(-1)).toEqual({
        kind: "done",
        stopReason: "cancelled",
      })
    })
  })
}

/**
 * The stop gate (#1263), run against every Engine: once the run is no longer
 * live, nothing the Engine still emits reaches the chat or the log. The
 * scripted model keeps streaming after the Stop, as an agent winding down
 * does, and the turn runs through the live boundary ({@link driveEngineTurn})
 * so the abort watchdog, not the Engine, decides when the run stopped.
 */
export function stopGateContractFor(
  name: string,
  makeEngine: (driver: StreamDriver) => Engine
) {
  describe(`Engine stop gate: ${name}`, () => {
    it("passes nothing on to the chat or the log once the run is stopped", async () => {
      const broadcasts: SessionUpdate[] = []
      const permissionRequests: RequestPermissionRequest[] = []
      const errors: string[] = []
      const records: AcpMessageRecord[] = []
      const toolCalls: AcpToolCallRecord[] = []
      const transitions: RunStatus[] = []
      let ends = 0
      const rows = new Map<string, RunStatus>([["run_1", "running"]])
      const ports: AcpConsumerPorts = {
        async broadcastUpdate(u) {
          broadcasts.push(u)
        },
        async broadcastError(m) {
          errors.push(m)
        },
        async broadcastEnd() {
          ends++
        },
        async appendRecord(r) {
          records.push(r)
        },
        async upsertToolCall(r) {
          toolCalls.push(r)
        },
        async transition(to) {
          transitions.push(to)
        },
        async broadcastPermissionRequest(r) {
          permissionRequests.push(r)
        },
        async pauseForPlan() {},
        async settleSteers() {},
      }
      const consumer = new AcpUpdateConsumer(ports)

      // The watchdog saw the Stop once it read the run as no longer live.
      let sawStop = () => {}
      const stopSeen = new Promise<void>((resolve) => (sawStop = resolve))
      const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
      const stop = async () => {
        // Stopped after the first chunk reached the chat.
        while (broadcasts.length === 0) await tick()
        rows.set("run_1", "aborted")
        await stopSeen
        await tick()
      }
      const read = toolCallChunks("call_1", "read_file")
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const plan = {
        type: "tool-call",
        toolCallId: "plan_1",
        toolName: SUBMIT_PLAN_TOOL,
        input: { plan: "never shown" },
      } as any
      /* eslint-enable @typescript-eslint/no-explicit-any */
      // An agent that ignores the cancel: it keeps narrating, runs a tool and
      // raises a plan gate after the Stop, then finishes normally.
      const driver: StreamDriver = (config) => ({
        consumeStream: async () => {
          const emit = (chunk: unknown) =>
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            config.onChunk?.({ chunk: chunk as any })
          await emit(textChunk("Looking"))
          await stop()
          await emit(textChunk(" at it more"))
          await emit(read.start)
          await emit(read.call)
          await emit(read.result)
          await emit(textChunk("Done."))
          await emit(plan)
          await config.onFinish?.({
            finishReason: "stop",
            totalUsage: {},
            response: { messages: [] },
            steps: [{}],
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any)
        },
      })

      await driveEngineTurn(
        makeEngine(driver),
        {
          chatId: "chat_1",
          runId: "run_1",
          roomId: "room_1",
          systemPrompt: "sys",
          model: "anthropic:test",
          history: [{ role: "user", content: [textBlock("hi")] }],
        },
        consumer,
        {
          async isRunActive(id) {
            const active = rows.get(id) === "running"
            if (!active) sawStop()
            return active
          },
          pollIntervalMs: 1,
        }
      )

      // Only what streamed before the Stop showed; nothing after it showed
      // or was kept, so a reload ends where the live chat did.
      expect(broadcasts).toEqual([
        {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Looking" },
        },
      ])
      expect(permissionRequests).toEqual([])
      expect(records).toEqual([])
      expect(toolCalls).toEqual([])
      // The Stop owns how the run ended: no completion, no error.
      expect(transitions).toEqual([])
      expect(errors).toEqual([])
      expect(ends).toBe(1)
      expect(rows.get("run_1")).toBe("aborted")
    })
  })
}
