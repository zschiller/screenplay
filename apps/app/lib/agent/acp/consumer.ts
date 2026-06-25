import type { RunStatus } from "../run-state"
import { agentChunksToRecord, thoughtChunksToRecord } from "./adapter"
import {
  applyToolCallUpdate,
  type AcpMessageRecord,
  type AcpToolCallRecord,
} from "./record"
import {
  blockText,
  isUpdate,
  planFromPermissionRequest,
  SUBMIT_PLAN_TOOL,
  type RequestPermissionRequest,
  type SessionUpdate,
  type StopReason,
} from "./schema"
import type { EngineUpdate } from "./engine-seam"

/**
 * The tool call halting a turn for human approval, derived by the consumer from
 * a plan-gate permission request. `chatId` is filled in by the live ports (the
 * consumer is chat-agnostic, like {@link AcpConsumerPorts.appendRecord}).
 */
export interface ConsumerPlanCall {
  toolCallId: string
  toolName: string
  input: Record<string, unknown>
}

/**
 * The side-effecting boundary the {@link AcpUpdateConsumer} drives. Split out
 * (like `RunStateRepo`) so the mapping logic is pure and tests can assert
 * "this ACP update stream produced these broadcasts, these ACP-native records,
 * and these run-state transitions" over in-memory fakes — never how the model
 * or the transport got there.
 */
export interface AcpConsumerPorts {
  /** Broadcast an ACP-shaped `session/update` to the Room over the Y.Doc. */
  broadcastUpdate(update: SessionUpdate): Promise<void>
  /**
   * Broadcast an error to the Room. ACP has no `error` session-update variant —
   * a turn failure is out-of-band — so this stays a screenplay broadcast.
   */
  broadcastError(message: string): Promise<void>
  /** Broadcast the `chat-stream-end` signal that closes the turn for clients. */
  broadcastEnd(): Promise<void>
  /** Append one ACP-native message record (agent reply or reasoning) to the log. */
  appendRecord(record: AcpMessageRecord): Promise<void>
  /**
   * Persist a tool-call record *in place* by `toolCallId` — an upsert, so the
   * `pending` → `in_progress` → `completed`/`failed` lifecycle updates the same
   * durable row rather than appending. Called on every `tool_call` /
   * `tool_call_update`, so a crash mid-turn leaves the call's last known state
   * on disk (repairable on next load).
   */
  upsertToolCall(record: AcpToolCallRecord): Promise<void>
  /** Record a run-state transition (no-ops on an already-terminal run). */
  transition(to: RunStatus): Promise<void>
  /**
   * Broadcast an ACP permission request to the Room. ACP's permission round-trip
   * is a JSON-RPC *request*, not a `session/update`, so it rides its own channel
   * — the browser renders the gate from this and the human responds (much later,
   * possibly after a reload) through the existing run lifecycle, not a live ACP
   * connection.
   */
  broadcastPermissionRequest(request: RequestPermissionRequest): Promise<void>
  /**
   * Pause the run for human plan approval: move it `running → paused_for_plan`
   * and record the pending tool-call atomically (ADR 0006). The live port adds
   * the `chatId` the run-state machine needs.
   */
  pauseForPlan(planCall: ConsumerPlanCall): Promise<void>
}

/**
 * The deep module that maps a single ACP `session/update` stream to app state
 * (ADR 0006): the Y.Doc broadcast (ACP-shaped), the ACP-native message append
 * (replacing `appendMessages` of `ModelMessage[]`), and the `RunState`
 * terminal transitions plus the `chat-stream-end` signal.
 *
 * It is the one place ACP becomes screenplay state, so both engines — the
 * in-process AI-SDK translator and a future real ACP client — feed the same
 * consumer and produce identical observable outcomes. It handles the text path
 * (`agent_message_chunk` + `done`) and the agent's reasoning
 * (`agent_thought_chunk`), plus the terminal error/stop outcomes; other
 * `sessionUpdate` kinds are broadcast through verbatim (so nothing is dropped)
 * and gain persistence in later slices.
 *
 * Feed every {@link EngineUpdate} to {@link handle} in order. Streamed text and
 * thought chunks are broadcast live *and* accumulated into the *current* block,
 * which is flushed to a durable record at every boundary — a switch between the
 * reply and reasoning streams, or a tool call — and once more at turn close. So
 * a turn that narrates, runs a tool, then narrates again persists three records
 * in arrival order (narration, tool call, narration), and a reload rebuilds the
 * same interleaving the live stream showed. Accumulating the whole turn into one
 * record instead would collapse those segments into a single block, drop their
 * order relative to the tool calls (which persist when first seen), and
 * concatenate the segments with no separator — exactly the reload corruption
 * this flush-on-boundary model avoids (issue: reload duplicated/mangled turns).
 */
export class AcpUpdateConsumer {
  /**
   * The narration/reasoning block currently streaming, accumulated until a
   * boundary flushes it to a durable record (see {@link flushPending}). Only one
   * block is ever pending: switching streams flushes the previous one first, so
   * `role` is unambiguous. `null` between blocks.
   */
  private pending: { role: "agent" | "thought"; texts: string[] } | null = null
  /**
   * In-flight tool calls, keyed by `toolCallId`, so a `tool_call_update` merges
   * onto the record we already hold rather than starting a new one — the same
   * in-place model the renderer uses.
   */
  private toolCalls = new Map<string, AcpToolCallRecord>()
  /** Guards against a double-close (e.g. `done` after an `error`). */
  private closed = false

  constructor(private readonly ports: AcpConsumerPorts) {}

  async handle(update: EngineUpdate): Promise<void> {
    switch (update.kind) {
      case "session_update":
        await this.onSessionUpdate(update.update)
        break
      case "permission_request":
        await this.onPermissionRequest(update.request)
        break
      case "done":
        await this.onDone(update.stopReason)
        break
      case "error":
        await this.onError(update.message)
        break
    }
  }

  private async onSessionUpdate(update: SessionUpdate): Promise<void> {
    // Accumulate streamed agent / reasoning text into the current block. We
    // still broadcast every chunk so clients render both the reply and the
    // reasoning as they stream; the durable record is written at the next
    // boundary (see flushPending).
    if (isUpdate(update, "agent_message_chunk")) {
      await this.pushText("agent", blockText(update.content))
    } else if (isUpdate(update, "agent_thought_chunk")) {
      await this.pushText("thought", blockText(update.content))
    } else if (
      isUpdate(update, "tool_call") ||
      isUpdate(update, "tool_call_update")
    ) {
      // A tool call ends the current narration/reasoning block. Flush that block
      // FIRST so its record lands ahead of the call on reload (preserving the
      // order the live stream showed), then update the one durable tool-call
      // record in place by id and persist it immediately (an upsert) so each
      // status transition is on disk before the next arrives. The broadcast
      // below carries the ACP update verbatim, so clients update in place too.
      await this.flushPending()
      const id = update.toolCallId
      const merged = applyToolCallUpdate(this.toolCalls.get(id), update)
      this.toolCalls.set(id, merged)
      await this.ports.upsertToolCall(merged)
    }
    await this.ports.broadcastUpdate(update)
  }

  /**
   * Append one streamed text delta to the current block, flushing the previous
   * block first when the stream switches (reply ⇄ reasoning) — the same boundary
   * the renderer breaks blocks on, so each contiguous run becomes its own record
   * in arrival order rather than being merged across the switch.
   */
  private async pushText(
    role: "agent" | "thought",
    text: string
  ): Promise<void> {
    if (this.pending && this.pending.role !== role) await this.flushPending()
    if (!this.pending) this.pending = { role, texts: [] }
    this.pending.texts.push(text)
  }

  /**
   * Persist the pending narration/reasoning block as one ACP-native record, in
   * arrival order, then clear it. An empty block (no text) writes nothing — no
   * spurious record. Cleared before the await so a re-entrant flush is a no-op.
   */
  private async flushPending(): Promise<void> {
    const pending = this.pending
    if (!pending) return
    this.pending = null
    const record =
      pending.role === "agent"
        ? agentChunksToRecord(pending.texts)
        : thoughtChunksToRecord(pending.texts)
    if (record.content.length > 0) await this.ports.appendRecord(record)
  }

  /**
   * The agent raised an ACP permission request — screenplay's plan-mode gate
   * (PRD #375). The turn halts here: any agent narration streamed before the
   * plan is flushed to a durable record, the request is broadcast so the Room
   * renders the approval card, and the run moves to `paused_for_plan` (carrying
   * the pending tool-call) instead of `completed`. The human's resolution
   * arrives later via the run lifecycle, not this stream, so we close the turn
   * with `broadcastEnd` — exactly like a normal terminal outcome.
   */
  private async onPermissionRequest(
    request: RequestPermissionRequest
  ): Promise<void> {
    if (this.closed) return
    this.closed = true

    // Flush the trailing narration/reasoning block streamed before the plan;
    // earlier blocks were already flushed at their boundaries, in arrival order.
    await this.flushPending()

    await this.ports.broadcastPermissionRequest(request)

    const { toolCallId, plan } = planFromPermissionRequest(request)
    await this.ports.pauseForPlan({
      toolCallId,
      toolName: SUBMIT_PLAN_TOOL,
      input: { plan },
    })

    await this.ports.broadcastEnd()
  }

  private async onDone(stopReason: StopReason): Promise<void> {
    if (this.closed) return
    this.closed = true

    // A clean ACP cancellation (a `/stop` or a supersession answered by the
    // agent resolving the turn with `stopReason: "cancelled"`, rather than the
    // abort surfacing as an `error`). The run lifecycle's watchdog already
    // recorded the terminal stop (`aborted`/`superseded`) when it tripped the
    // signal, so this is **not** a completion and **not** a failure: surface the
    // stop so the UI unsticks and close, with no `completed` transition that
    // would mislabel a stopped turn. Mirrors the in-process engine's abort path,
    // which reaches the consumer as `error: "Stopped by user"` instead.
    if (stopReason === "cancelled") {
      await this.ports.broadcastError("Stopped by user")
      await this.ports.broadcastEnd()
      return
    }

    // Persist the trailing narration/reasoning block (everything since the last
    // boundary) as its own ACP-native record; earlier blocks were already
    // flushed at their boundaries, in arrival order. An empty block writes
    // nothing — nothing to keep.
    await this.flushPending()
    await this.ports.transition("completed")
    await this.ports.broadcastEnd()
  }

  private async onError(message: string): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.ports.broadcastError(message)
    // A genuine failure records `failed`; a user `/stop` or supersession has
    // already moved the run to a terminal state, so this transition no-ops and
    // the "Stopped by user" outcome is preserved (it is not a failure).
    await this.ports.transition("failed")
    await this.ports.broadcastEnd()
  }
}
