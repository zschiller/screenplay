import type { Tool } from "ai"
import type { ToolContext } from "../tools"
import type { AcpMessageRecord } from "./record"
import type {
  ContentBlock,
  RequestPermissionRequest,
  SessionUpdate,
  StopReason,
} from "./schema"

/**
 * The seam vocabulary — what an {@link Engine} reports as it drives one turn.
 *
 * Each item is either a genuine ACP `session/update` body, an ACP **permission
 * request** the agent raises mid-turn, or one of the two terminal outcomes ACP
 * expresses *out of band* of the update stream: a prompt turn resolves with a
 * `stopReason` (ACP `PromptResponse`), and a transport/model failure surfaces as
 * an error. We deliver them all through the same sink so the consumer drains one
 * ordered stream — but each payload is ACP, never screenplay-shaped.
 *
 * `permission_request` is how screenplay's plan-mode approval gate reaches the
 * consumer: it carries an ACP {@link RequestPermissionRequest} (see
 * {@link import("./schema").planPermissionRequest}) and is deliberately kept
 * distinct from a `session_update` whose `sessionUpdate` is the informational
 * `"plan"` TODO list — conflating them would break the swap to a real ACP
 * client (PRD #375, design goal 1).
 */
export type EngineUpdate =
  | { kind: "session_update"; update: SessionUpdate }
  | { kind: "permission_request"; request: RequestPermissionRequest }
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
  /**
   * The turn's Skill index as a note (#1555). The system prompt carries it
   * too, so an Engine that sends the prompt every turn ignores this; one that
   * resumes a session holding its first turn's prompt leads the new user
   * message with it, so a Skill saved since is known.
   */
  skillsNote?: string
  model: string
  /** ACP-native conversation history (prior turns + the new user message). */
  history: AcpMessageRecord[]
  /** Pre-built tools for the turn (sandbox / document toolset). */
  tools?: Record<string, Tool>
  /** Tool context for the default sandbox toolset when `tools` is omitted. */
  toolCtx?: ToolContext
  /**
   * Whether the user sent this turn in plan mode. The in-process engine drives
   * plan mode through the prompt/toolset; the external ACP engine maps it onto
   * the agent's native plan mode (`session/set_mode`), the only state in which a
   * real adapter raises the approval-gate permission request (spike #408).
   */
  planMode?: boolean
  /**
   * The pull port an Engine calls at each step boundary of a run that steers
   * (#1190): it takes every pending Steer for this run, oldest first, and has
   * already settled them into the transcript as user messages by the time it
   * resolves. The Engine hands what it took to the model before its next step,
   * and checks once more before the turn would finish. Absent when the turn
   * can't be steered.
   */
  takeSteers?: TakeSteers
  /**
   * Where the Engine says, once its session is open, whether this run takes
   * Steers (#1250). Steerability is a fact about the run, not the Engine: the
   * external engine learns at initialize whether the Harness queues prompts
   * (#1191); the in-process engine always does. Until it reports, and after a
   * no, every message sent mid-run is queued. Present only alongside
   * {@link takeSteers}.
   */
  reportSteering?: (steers: boolean) => Promise<void>
}

/** A Steer the Engine took, as the content its user message carries. */
export interface TakenSteer {
  id: string
  content: ContentBlock[]
  /** Who sent it, by user id; absent for a message nobody typed. */
  sentBy?: string
}

/**
 * Take every pending Steer for the run now (empty when there are none).
 *
 * With `deliver`, each Steer is handed to the agent before it settles (#1192):
 * an Engine whose agent answers whether it took a message (Codex's steering
 * request) passes it, and only a Steer it delivered settles into the
 * transcript. The first one it can't deliver goes back to the inbox with every
 * Steer after it, still pending, so a later step boundary takes them again or
 * Turn Launch hands them on. The result is what was delivered.
 */
export type TakeSteers = (deliver?: DeliverSteer) => Promise<TakenSteer[]>

/** Hand one taken Steer to the agent; false when it didn't take it. */
export type DeliverSteer = (steer: TakenSteer) => Promise<boolean>

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

/** Prompt-cache token usage for a completed turn (the AI SDK's all-step `usage`). */
export interface PromptCacheUsage {
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/**
 * Capability sub-interface: an engine that can report prompt-cache token usage
 * for the turn it just ran — the all-step `usage` the in-process loop logs in
 * `onEnd`. Not every engine can: a generic ACP agent may never surface
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
