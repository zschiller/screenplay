import type { Engine, EngineTurn, EngineUpdateSink } from "./engine-seam"
import type { AcpMessageRecord } from "./record"
import type { AcpSession, AcpSessionPorts, OpenSessionOptions } from "./session"
import type { ContentBlock } from "./schema"

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
 * the two: when the agent raises a permission request it forwards it to the
 * consumer (which pauses the run and ends the turn) and winds the *live* ACP
 * turn down, so the agent answers `cancelled` and stands down. The resume
 * arrives as a new run, exactly as it does for the in-process engine.
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
      const session = await this.config.sessionFactory.open(ports, {
        cwd: this.config.cwd ?? "/",
      })
      const stopReason = await session.prompt(
        promptBlocks(turn.history),
        turnSignal
      )

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
}

/**
 * The new user turn's ACP content blocks — the last `user` record in the
 * ACP-native history. The agent owns its own session state, so a turn sends only
 * the new prompt; prior turns are the session's (loaded or accumulated) history.
 */
function promptBlocks(history: AcpMessageRecord[]): ContentBlock[] {
  for (let i = history.length - 1; i >= 0; i--) {
    const record = history[i]!
    if (record.role === "user") return record.content
  }
  return []
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
