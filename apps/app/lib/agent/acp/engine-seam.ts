import type { Tool } from "ai"
import type { ToolContext } from "../tools"
import type { AcpMessageRecord } from "./record"
import type { SessionUpdate, StopReason } from "./schema"

/**
 * The seam vocabulary — what an {@link Engine} reports as it drives one turn.
 *
 * Each item is either a genuine ACP `session/update` body, or one of the two
 * terminal outcomes ACP expresses *out of band* of the update stream: a prompt
 * turn resolves with a `stopReason` (ACP `PromptResponse`), and a
 * transport/model failure surfaces as an error. We deliver all three through
 * the same sink so the consumer drains one ordered stream — but the
 * `session_update` payload itself is never screenplay-shaped, it is ACP.
 */
export type EngineUpdate =
  | { kind: "session_update"; update: SessionUpdate }
  | { kind: "done"; stopReason: StopReason }
  | { kind: "error"; message: string }

/** Where an engine reports its updates. Awaited so ordering is preserved. */
export type EngineUpdateSink = (update: EngineUpdate) => Promise<void> | void

/** Everything an engine needs to drive one turn of a Chat Session. */
export interface EngineTurn {
  chatId: string
  runId: string
  roomId: string
  systemPrompt: string
  model: string
  /** ACP-native conversation history (prior turns + the new user message). */
  history: AcpMessageRecord[]
  /** Pre-built tools for the turn (sandbox / document toolset). */
  tools?: Record<string, Tool>
  /** Tool context for the default sandbox toolset when `tools` is omitted. */
  toolCtx?: ToolContext
}

/**
 * The honest Engine seam (ADR 0006), modelled on the sandbox-provider split of
 * ADR 0003: the **portable core** is the single thing every engine — the
 * in-process AI-SDK translator *and* a future real ACP client — can honor.
 *
 * `run` drives one turn to completion, reporting ACP session updates (and the
 * terminal `stopReason`) to `sink`, and stands down when `signal` aborts (a
 * user `/stop` or a supersession). There are deliberately **no optional
 * methods** and **no capabilities bag** here; capabilities live in sub-
 * interfaces gated by a type guard (see {@link supportsUsageReporting}).
 */
export interface Engine {
  /** Stable identifier, surfaced in logs and selection. */
  readonly id: string
  run(
    turn: EngineTurn,
    sink: EngineUpdateSink,
    signal: AbortSignal
  ): Promise<void>
}

/** Prompt-cache token usage for a completed turn (Anthropic `totalUsage`). */
export interface PromptCacheUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/**
 * Capability sub-interface: an engine that can report prompt-cache token usage
 * for the turn it just ran — the `totalUsage` the in-process loop logs in
 * `onFinish`. Not every engine can: a generic ACP agent may never surface
 * usage, so this is **not** a method on the core. It sits behind the
 * {@link supportsUsageReporting} type guard, exactly as `snapshot()` etc. sit
 * behind `supportsHibernation` (ADR 0003) — an engine that can't report usage
 * simply isn't narrowed, and the caller takes the no-usage branch.
 */
export interface UsageReportingEngine extends Engine {
  readonly reportsUsage: true
  /** Usage for the most recently completed turn, or null if none was produced. */
  lastTurnUsage(): PromptCacheUsage | null
}

/**
 * The capability check. Rejected alternatives (per ADR 0003): an optional
 * `lastTurnUsage?()` on the core (a half-implementer type-checks fine and the
 * branch is forgettable), and a `capabilities` bag (over-structured for one
 * capability today).
 */
export function supportsUsageReporting(
  engine: Engine
): engine is UsageReportingEngine {
  return (engine as Partial<UsageReportingEngine>).reportsUsage === true
}
