import type { RunStatus } from "../run-state"
import { agentChunksToRecord } from "./adapter"
import type { AcpMessageRecord } from "./record"
import { blockText, isUpdate, type SessionUpdate } from "./schema"
import type { EngineUpdate } from "./engine-seam"

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
  /** Append the turn's ACP-native agent message record to the durable log. */
  appendAgentMessage(record: AcpMessageRecord): Promise<void>
  /** Record a run-state transition (no-ops on an already-terminal run). */
  transition(to: RunStatus): Promise<void>
}

/**
 * The deep module that maps a single ACP `session/update` stream to app state
 * (ADR 0006): the Y.Doc broadcast (ACP-shaped), the ACP-native message append
 * (replacing `appendMessages` of `ModelMessage[]`), and the `RunState`
 * terminal transitions plus the `chat-stream-end` signal.
 *
 * It is the one place ACP becomes screenplay state, so both engines — the
 * in-process AI-SDK translator and a future real ACP client — feed the same
 * consumer and produce identical observable outcomes. For the first tracer
 * bullet it handles the text path (`agent_message_chunk` + `done`), plus the
 * terminal error/stop outcomes; other `sessionUpdate` kinds are broadcast
 * through verbatim (so nothing is dropped) and gain persistence in later slices.
 *
 * Feed every {@link EngineUpdate} to {@link handle} in order. Streamed text
 * chunks are broadcast live *and* accumulated, so the single ACP-native agent
 * record persisted at `done` reflects the whole turn.
 */
export class AcpUpdateConsumer {
  /** Streamed `agent_message_chunk` text, accumulated for the durable record. */
  private agentText: string[] = []
  /** Guards against a double-close (e.g. `done` after an `error`). */
  private closed = false

  constructor(private readonly ports: AcpConsumerPorts) {}

  async handle(update: EngineUpdate): Promise<void> {
    switch (update.kind) {
      case "session_update":
        await this.onSessionUpdate(update.update)
        break
      case "done":
        await this.onDone()
        break
      case "error":
        await this.onError(update.message)
        break
    }
  }

  private async onSessionUpdate(update: SessionUpdate): Promise<void> {
    // Accumulate streamed agent text for the durable ACP-native record. We
    // still broadcast every chunk so clients render the reply as it streams.
    if (isUpdate(update, "agent_message_chunk")) {
      this.agentText.push(blockText(update.content))
    }
    await this.ports.broadcastUpdate(update)
  }

  private async onDone(): Promise<void> {
    if (this.closed) return
    this.closed = true
    // Persist the whole turn's text as one ACP-native agent record. An empty
    // turn (no text) yields an empty content list, which we skip — there's
    // nothing to replay.
    const record = agentChunksToRecord(this.agentText)
    if (record.content.length > 0) {
      await this.ports.appendAgentMessage(record)
    }
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
