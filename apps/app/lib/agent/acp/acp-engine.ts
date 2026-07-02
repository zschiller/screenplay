import type { Engine, EngineTurn, EngineUpdateSink } from "./engine-seam"
import type { AcpMessageRecord } from "./record"
import type { AcpSession, AcpSessionPorts, OpenSessionOptions } from "./session"
import { blockText, textBlock, type ContentBlock } from "./schema"

/**
 * How the {@link ExternalEngine} obtains a live ACP session for a turn. Production
 * injects a factory that spawns/connects to a generic ACP agent — stdio via
 * `ndJsonStream`, or a socket — and runs the handshake + new-or-load inside
 * {@link AcpSession.open}; tests inject one crossing an in-memory stream to a
 * fake agent. Either way the engine drives the *same* {@link AcpSession}, so the
 * transport's backing never leaks into the engine. Production transport
 * hardening (process supervision, reconnection) lives in the factory, above this
 * seam, and is out of scope here (PRD #375; ADR 0006).
 */
export interface AcpSessionFactory {
  open(ports: AcpSessionPorts, options: OpenSessionOptions): Promise<AcpSession>
}

/** Everything the {@link ExternalEngine} needs to drive turns against an ACP agent. */
export interface ExternalEngineConfig {
  sessionFactory: AcpSessionFactory
  /** Working directory advertised to the agent (absolute path). */
  cwd?: string
  /**
   * The chat's stored native ACP session id, when one was bound by an earlier
   * turn. Present → the turn resumes that session via `session/load` so the
   * agent has its own prior context (the durable fix for desktop chats whose
   * model couldn't see earlier messages — issue: native session resume). Absent
   * → a fresh `session/new` whose context is seeded by replaying history.
   */
  loadSessionId?: string
  /**
   * Persist a freshly created native session id so the *next* turn can resume
   * it. Called only when this turn opens a new session (first turn, or a
   * `session/load` miss); a successful load reuses the same id and skips this.
   */
  onSessionId?: (sessionId: string) => Promise<void> | void
  /**
   * The chat's chosen model *within* the Harness (the `modelId` half of its
   * stored `harness:<key>:<modelId>` id — ADR 0006: it refines which model the
   * already-build-selected external engine runs, never the engine itself). At
   * session open the ACP-native adapter applies it via `set_config_option`; an
   * adapter that takes its model at spawn (codex) already has it on the argv, so
   * this is inert there. Absent ⇒ the Harness runs its own default.
   */
  modelId?: string
  /**
   * Persist the resolved model id after a session-open silent fallback, when the
   * stored model was stale (#526). Threaded to {@link AcpSession} so both the
   * eager open-time reconcile and the prompt-time recovery write through one
   * path. Absent ⇒ no reconciliation (e.g. a sandbox-less chat with no id to key
   * on).
   */
  reconcileModel?: (modelId: string) => Promise<void> | void
}

/**
 * The **External Engine** (ADR 0006, PRD #375): the second implementation of the
 * {@link Engine} seam — named for *where the model runs* (a separate external
 * agent), the axis that actually distinguishes it from the in-process engine.
 * Both engines speak ACP at the seam; this one is the genuine ACP *client* (ACP
 * is its native wire protocol to the external agent), where the in-process engine
 * runs the model itself via the AI SDK and translates to ACP. It sits behind the
 * *same* seam the in-process AI-SDK translator
 * sits behind. Where the in-process engine runs the model itself and translates
 * AI-SDK chunks into ACP, this engine is a thin client over a real ACP agent: it
 * drives the {@link AcpSession} module (the way the in-process engine drives
 * `streamText`) and passes the agent's genuine `session/update`s through to the
 * sink **nearly natively**, so both engines feed the same
 * {@link import("./consumer").AcpUpdateConsumer} and reach identical app state.
 * The shared contract test proves the two are interchangeable.
 *
 * **Graceful capability degradation (ADR 0003 / ADR 0006).** This engine
 * deliberately does **not** implement {@link
 * import("./engine-seam").UsageReportingEngine}: a generic ACP agent may never
 * surface prompt-cache `totalUsage`, so the capability is simply absent and
 * {@link import("./engine-seam").supportsUsageReporting} narrows it out — the
 * caller takes the no-usage branch rather than calling a half-implemented
 * method.
 *
 * **Plan-mode mapping (the riskiest seam).** screenplay's approval gate is
 * *asynchronous* — the human resolves it much later (possibly after a reload)
 * via a fresh prompt through `/api/agent/plan` — whereas ACP's permission
 * request is an *in-turn* round-trip the agent blocks on. The engine reconciles
 * the two **only for the approval gate**: on a plan-mode turn the agent's
 * permission request is the ExitPlanMode gate, so the engine forwards it to the
 * consumer (which pauses the run and ends the turn) and winds the *live* ACP
 * turn down — the agent answers `cancelled` and stands down, and the resume
 * arrives as a new run, exactly as it does for the in-process engine. Every
 * *other* permission request a real adapter raises (file edits, command runs on
 * a non-plan turn) is an ordinary tool approval the engine **auto-allows**, so
 * the tool runs to completion instead of being mistaken for an empty plan.
 *
 * **Stop / supersession.** A user `/stop` or a supersession reaches the engine
 * as an aborted `signal`; the session sends `session/cancel` and the agent
 * resolves the turn `cancelled`. The engine reports a `done` carrying the
 * cancellation (or, if the abort surfaced as a thrown transport error,
 * `error: "Stopped by user"`) — the consumer maps either to a stop with no
 * `completed`/`failed` transition, the run lifecycle's watchdog having already
 * recorded the terminal stop.
 */
export class ExternalEngine implements Engine {
  readonly id = "external"

  constructor(private readonly config: ExternalEngineConfig) {}

  async run(
    turn: EngineTurn,
    sink: EngineUpdateSink,
    signal: AbortSignal
  ): Promise<void> {
    // screenplay's plan gate is async (the human resolves later via a fresh
    // prompt), not ACP's in-turn permission round-trip. So when the agent raises
    // a permission request we hand it to the consumer (which pauses the run and
    // ends the turn) and wind the live ACP turn down via this controller — the
    // resume arrives as a new run, exactly like the in-process engine.
    const planPause = new AbortController()
    const ports: AcpSessionPorts = {
      onUpdate: (update) => sink({ kind: "session_update", update }),
      requestPlanApproval: async (request) => {
        // A real ACP adapter (`claude-agent-acp`) raises a permission request for
        // *every* tool operation it wants to run — file edits, command
        // execution — not just the plan-mode gate. The approval gate surfaces
        // only on a plan-mode turn (the agent's ExitPlanMode request, reachable
        // only after `session/set_mode(plan)` — spike #408). So gate ONLY when
        // the turn is in plan mode; otherwise this is an ordinary tool approval
        // and we auto-allow it (`pickOption` selects an allow option) so the
        // tool runs to completion.
        //
        // Treating ordinary approvals as the gate was the desktop-chat bug:
        // each edit became an empty plan (no `rawInput.plan`) that paused and
        // cancelled the turn, leaving the in-flight tool call's chip spinning
        // forever; the agent then re-read, re-edited, re-asked, and looped
        // without end. Auto-allowing matches the in-process engine, which runs
        // its tools with no permission gate at all.
        if (!turn.planMode) return { approved: true }

        await sink({ kind: "permission_request", request })
        planPause.abort()
        // Not used as a decision: the aborted turn signal makes the session
        // answer the outstanding permission `cancelled` (per spec) rather than
        // selecting an option, so the agent stands down instead of resuming.
        return { approved: false }
      },
    }

    const turnSignal = anySignal(signal, planPause.signal)
    try {
      const { session, resumed } = await this.openSession(ports, turn)
      // A resumed session already holds the prior conversation, so send only the
      // new user message. A fresh session has none — replay the whole history so
      // its context is seeded (the first turn reduces to just the new message),
      // and lead with the system prompt so the agent's instructions (the
      // always-commit-and-push rule, plan-mode protocol, skill index) reach it.
      const blocks = resumed
        ? promptBlocks(turn.history)
        : withSystemPrompt(turn.systemPrompt, replayBlocks(turn.history))
      const stopReason = await session.prompt(blocks, turnSignal)

      // The plan gate already closed the turn through the consumer; emitting a
      // terminal update now would be a no-op (the consumer guards a double
      // close), but skip it so the seam stays legible.
      if (planPause.signal.aborted) return
      // A real `/stop` / supersession: report it as a stop, never a completion,
      // even though the agent reported its `stopReason` on the way out. The
      // consumer maps a cancelled `done` to "Stopped by user" with no
      // `completed` transition; the watchdog already recorded the terminal stop.
      if (signal.aborted) {
        await sink({ kind: "done", stopReason: "cancelled" })
        return
      }
      await sink({ kind: "done", stopReason })
    } catch (e) {
      if (signal.aborted) {
        // The run is no longer live (user `/stop` or supersession) and the abort
        // surfaced as a thrown transport/stream error rather than a clean
        // cancellation. Report it as a stop — the consumer's `failed` transition
        // no-ops on the already-terminal run.
        await sink({ kind: "error", message: "Stopped by user" })
      } else {
        await sink({
          kind: "error",
          message: e instanceof Error ? e.message : String(e),
        })
      }
    }
  }

  /**
   * Open the session for this turn, resuming the agent's own session when one is
   * stored and creating a fresh one otherwise.
   *
   * `resumed: true` ⇒ a `session/load` succeeded and the agent carries its prior
   * context. `resumed: false` ⇒ a `session/new`; the caller replays history to
   * seed it, and the new id is persisted via {@link ExternalEngineConfig.onSessionId}.
   *
   * **Load-miss fallback.** A stored id can be unloadable — the agent restarted
   * with no record of it, or the adapter doesn't honor `loadSession`. We don't
   * try to distinguish that from a genuine transport failure: we just retry once
   * as a fresh session. If the agent really is broken, the retry surfaces the
   * real error; if only the load was stale, the fresh session + history replay
   * keeps the turn going with full context instead of failing it.
   */
  private async openSession(
    ports: AcpSessionPorts,
    turn: EngineTurn
  ): Promise<{ session: AcpSession; resumed: boolean }> {
    const cwd = this.config.cwd ?? "/"
    // A plan-mode turn opens the agent in its native plan mode, so the
    // ExitPlanMode permission request (the approval gate) can surface (spike
    // #408). Non-plan turns and mode-less agents pass through.
    const planMode = turn.planMode

    // The chat's per-chat model choice, applied at open via ACP-native model
    // selection (claude-code) — inert for a spawn-applied adapter (codex) and
    // for a chat with no stored model. Reconciliation rewrites a stale stored id
    // to the resolved one (#526).
    const { modelId, reconcileModel } = this.config

    if (this.config.loadSessionId) {
      try {
        const session = await this.config.sessionFactory.open(ports, {
          cwd,
          planMode,
          modelId,
          reconcileModel,
          loadSessionId: this.config.loadSessionId,
        })
        return { session, resumed: true }
      } catch {
        // Load miss — fall through to a fresh session that replays history.
      }
    }

    const session = await this.config.sessionFactory.open(ports, {
      cwd,
      planMode,
      modelId,
      reconcileModel,
    })
    await this.config.onSessionId?.(session.id)
    return { session, resumed: false }
  }
}

/**
 * Lead a fresh session's prompt with the turn's system prompt as a text block.
 *
 * ACP has no system-prompt channel — `session/new` and `session/prompt` carry
 * only `cwd`/`mcpServers` and content blocks — so the only way to deliver
 * screenplay's agent instructions (the always-commit-and-push rule, the
 * plan-mode protocol, the merged skill index, `@`-mention resolution, repo
 * context) to a generic ACP agent is to fold them into the prompt itself. The
 * in-process engine passes the same string as `streamText`'s `system`; this is
 * the external engine's equivalent. Without it the desktop agent ran with *no*
 * screenplay instructions — most visibly, it never committed and pushed, so the
 * user never saw its changes.
 *
 * Applied only on a **fresh** session (the turn that creates it): a resumed
 * session already carries the instructions the creating turn sent, in the
 * agent's own context, so re-sending them every turn would only bloat it. An
 * empty prompt prepends nothing, keeping the seam clean for agents/tests that
 * pass none.
 */
function withSystemPrompt(
  systemPrompt: string,
  blocks: ContentBlock[]
): ContentBlock[] {
  const trimmed = systemPrompt.trim()
  return trimmed ? [textBlock(trimmed), ...blocks] : blocks
}

/**
 * The new user turn's ACP content blocks — the last `user` record in the
 * ACP-native history. Used when the agent's own session is resumed, so the turn
 * sends only the new prompt and the rest is the loaded session's history.
 */
function promptBlocks(history: AcpMessageRecord[]): ContentBlock[] {
  return lastUserContent(history) ?? []
}

/**
 * The prompt for a *fresh* session, which holds no prior context. Replays the
 * whole conversation as one user turn: prior turns flattened into a labeled text
 * transcript, followed by the new user message's own blocks verbatim (so its
 * `resource_link`s and other structure survive). On the first turn there is no
 * prior history, so this is exactly {@link promptBlocks}.
 *
 * This is the lossy degradation path — only the new-session route reaches it
 * (first turn, or a `session/load` miss), where conveying context as text beats
 * dropping it. A resumed session never replays; it inherits the agent's own
 * richer history.
 */
function replayBlocks(history: AcpMessageRecord[]): ContentBlock[] {
  const lastUserIndex = lastUserRecordIndex(history)
  if (lastUserIndex <= 0) return promptBlocks(history)

  const transcript = priorTranscript(history.slice(0, lastUserIndex))
  // `lastUserIndex` points at a `user` record by construction; narrow the union
  // so its `content` is `ContentBlock[]` rather than the record's wider type.
  const newRecord = history[lastUserIndex]!
  const newMessage = newRecord.role === "user" ? newRecord.content : []
  return transcript ? [textBlock(transcript), ...newMessage] : newMessage
}

/** Flatten the records before the new user turn into a labeled text transcript. */
function priorTranscript(records: AcpMessageRecord[]): string {
  const lines: string[] = []
  for (const record of records) {
    if (record.role === "user") {
      lines.push(`User: ${recordText(record.content)}`)
    } else if (record.role === "agent") {
      lines.push(`Assistant: ${recordText(record.content)}`)
    } else if (record.role === "tool_call") {
      // The structured output doesn't replay as text; a one-line marker keeps
      // the turn's shape legible without dumping diffs/terminal blobs.
      lines.push(`[tool: ${record.title} — ${record.status}]`)
    }
    // `thought` is intentionally omitted — reasoning is never replayed into the
    // model's input (mirrors `acpHistoryToModelMessages`).
  }
  const body = lines.filter((line) => line.trim().length > 0).join("\n\n")
  if (!body) return ""
  return [
    "This is a continuation of an earlier conversation the agent has lost. Prior messages, for context:",
    "",
    body,
    "",
    "---",
    "",
    "Continue from here. The user's new message follows:",
  ].join("\n")
}

/** Concatenate a record's text blocks into a single string. */
function recordText(content: ContentBlock[]): string {
  return content.map(blockText).join("").trim()
}

/** Index of the last `user` record, or -1 if the history has none. */
function lastUserRecordIndex(history: AcpMessageRecord[]): number {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i]!.role === "user") return i
  }
  return -1
}

/** The last `user` record's content, or null if the history has no user turn. */
function lastUserContent(history: AcpMessageRecord[]): ContentBlock[] | null {
  const index = lastUserRecordIndex(history)
  if (index < 0) return null
  // The index is a `user` record by construction; narrow to its `ContentBlock[]`.
  const record = history[index]!
  return record.role === "user" ? record.content : null
}

/** Merge two abort signals: the result aborts when either input does. */
function anySignal(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof AbortSignal.any === "function") return AbortSignal.any([a, b])
  const controller = new AbortController()
  if (a.aborted || b.aborted) {
    controller.abort()
  } else {
    const onAbort = () => controller.abort()
    a.addEventListener("abort", onAbort, { once: true })
    b.addEventListener("abort", onAbort, { once: true })
  }
  return controller.signal
}
