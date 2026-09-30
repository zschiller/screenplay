import type { RunStatus } from "../run-state"
import { isNoReply, NO_REPLY_MAX_LENGTH } from "../coordinator-wake"
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
import type { EngineUpdate, TakenSteer } from "./engine-seam"

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
  /**
   * Settle Steers the Engine just took (#1190) into the transcript as user
   * messages: persist each as an ACP-native `user` record and tell every
   * client they are no longer pending, each followed by its
   * `user_message_chunk`.
   */
  settleSteers(steers: TakenSteer[]): Promise<void>
  /**
   * Whether the run is still the live one (`running`). Asked before each
   * durable write, so output that raced a Stop never lands in the log after
   * the run's Stopped marker. Absent means live.
   */
  isLive?(): Promise<boolean>
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
  private pending: {
    role: "agent" | "thought"
    texts: string[]
    /**
     * On a wake turn, the reply chunks not broadcast yet: held while the
     * reply could still be a no-reply line (#1224). `null` once released.
     */
    held: SessionUpdate[] | null
  } | null = null
  /**
   * In-flight tool calls, keyed by `toolCallId`, so a `tool_call_update` merges
   * onto the record we already hold rather than starting a new one — the same
   * in-place model the renderer uses.
   */
  private toolCalls = new Map<string, AcpToolCallRecord>()
  /** Guards against a double-close (e.g. `done` after an `error`). */
  private closed = false
  /**
   * Set once the run is no longer live (a Stop or a supersession). From then
   * on nothing reaches the chat or the log, whatever the Engine still emits
   * while it winds down; its terminal update only ends the stream.
   */
  private stopped = false

  /**
   * `wake`: the turn answers a Coordinator wake (#897), so a reply that is
   * only a stock no-reply line ("No response requested.") is neither
   * broadcast nor stored (#1224). Other turns show every reply.
   */
  constructor(
    private readonly ports: AcpConsumerPorts,
    private readonly options: { wake?: boolean } = {}
  ) {}

  /**
   * The run is no longer live. Whatever the Engine emits from here on is
   * dropped, on every Engine: the chat already shows the Stopped marker, and
   * the reload places that marker where the log ends.
   */
  stop(): void {
    this.stopped = true
  }

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

  /**
   * Settle Steers the Engine took at a step boundary (#1190). The narration
   * block streaming before the boundary is flushed first, so each Steer lands
   * in the log where the agent took it: after the step that preceded it and
   * before the one it steers. Nothing settles once the turn has closed.
   */
  async acceptSteers(steers: TakenSteer[]): Promise<void> {
    if (this.closed || this.stopped || steers.length === 0) return
    await this.flushPending()
    await this.ports.settleSteers(steers)
  }

  private async onSessionUpdate(update: SessionUpdate): Promise<void> {
    // The turn is over: once it closed or stopped, nothing more shows.
    if (this.closed || this.stopped) return
    // The user turn is the server's own echo (Turn Launch broadcasts it and
    // persists it with its markers). An agent's user_message_chunk (a harness
    // replaying a prompt or a subagent's ask) is never persisted, so passing
    // it on would draw a bubble that vanishes on reload, without the markers
    // that hide a Coordinator wake.
    if (isUpdate(update, "user_message_chunk")) return
    // Accumulate streamed agent / reasoning text into the current block. We
    // still broadcast every chunk so clients render both the reply and the
    // reasoning as they stream; the durable record is written at the next
    // boundary (see flushPending).
    if (isUpdate(update, "agent_message_chunk")) {
      await this.pushText("agent", blockText(update.content))
      if (this.pending?.held) {
        this.pending.held.push(update)
        await this.releaseHeldPastNoReply()
        return
      }
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
      if (!(await this.stillLive())) return
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
    if (!this.pending) {
      const held = role === "agent" && this.options.wake ? [] : null
      this.pending = { role, texts: [], held }
    }
    this.pending.texts.push(text)
  }

  /**
   * Broadcast a wake turn's held reply chunks once the reply has grown too
   * long to be a no-reply line; after that its chunks stream as usual.
   */
  private async releaseHeldPastNoReply(): Promise<void> {
    const pending = this.pending
    if (!pending?.held) return
    if (pending.texts.join("").trim().length <= NO_REPLY_MAX_LENGTH) return
    const held = pending.held
    pending.held = null
    for (const chunk of held) await this.ports.broadcastUpdate(chunk)
  }

  /**
   * Whether the run is still live, asked before a durable write. A run found
   * stopped stops the consumer, so a Stop the watchdog hasn't seen yet still
   * keeps the write (and everything after it) out of the log.
   */
  private async stillLive(): Promise<boolean> {
    if (this.stopped) return false
    const live = await this.ports.isLive?.().catch(() => true)
    if (live === false) this.stop()
    return !this.stopped
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
    if (!(await this.stillLive())) return
    if (pending.held) {
      // A wake turn's short reply: a no-reply line says nothing, so it
      // never shows; anything else goes out now, before its record.
      if (isNoReply(pending.texts.join(""))) return
      for (const chunk of pending.held) await this.ports.broadcastUpdate(chunk)
    }
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
    if (this.closed || this.stopped) return
    // Flush the trailing narration/reasoning block streamed before the plan;
    // earlier blocks were already flushed at their boundaries, in arrival order.
    await this.flushPending()
    if (!(await this.stillLive())) return
    this.closed = true

    await this.ports.broadcastPermissionRequest(request)

    const { toolCallId, input } = planFromPermissionRequest(request)
    await this.ports.pauseForPlan({
      toolCallId,
      toolName: SUBMIT_PLAN_TOOL,
      input,
    })

    await this.ports.broadcastEnd()
  }

  private async onDone(stopReason: StopReason): Promise<void> {
    if (this.closed) return
    this.closed = true

    // A cancellation: a `/stop` or a supersession, which every Engine reports
    // as `stopReason: "cancelled"`. The run lifecycle's watchdog already
    // recorded the terminal stop (`aborted`/`superseded`) when it tripped the
    // signal, so this is **not** a completion and **not** a failure: close the
    // stream so the UI unsticks, with no `completed` transition that would
    // mislabel it and no error. What a stopped or superseded run shows is
    // Turn Launch's decision (see `STOPPED_RUN_STATUS`), not the consumer's.
    if (stopReason === "cancelled" || this.stopped) {
      await this.ports.broadcastEnd()
      return
    }

    // Persist the trailing narration/reasoning block (everything since the last
    // boundary) as its own ACP-native record; earlier blocks were already
    // flushed at their boundaries, in arrival order. An empty block writes
    // nothing — nothing to keep.
    await this.flushPending()
    // Found stopped at that last write: the stop owns how the turn ends.
    if (!this.stopped) await this.ports.transition("completed")
    await this.ports.broadcastEnd()
  }

  private async onError(message: string): Promise<void> {
    if (this.closed) return
    this.closed = true
    // A stopped run's Engine failing as it winds down is still the stop.
    if (this.stopped) {
      await this.ports.broadcastEnd()
      return
    }
    await this.ports.broadcastError(message)
    // A genuine failure records `failed`. The transition no-ops on a run that
    // already reached a terminal state, so a late error can't relabel it.
    await this.ports.transition("failed")
    await this.ports.broadcastEnd()
  }
}
