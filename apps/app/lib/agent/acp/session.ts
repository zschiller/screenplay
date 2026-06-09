import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type Client,
  type ContentBlock,
  type PermissionOption,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionUpdate,
  type StopReason,
  type Stream,
} from "./schema"

/**
 * The generic ACP session module (PRD #375, ADR 0006): one screenplay-facing
 * handle that speaks **genuine ACP** to *any* conforming agent over an
 * abstracted transport. It owns the client half of an ACP conversation —
 * handshake/initialize, new-or-load session, sending a turn as a `prompt`, and
 * consuming the `session/update` stream — and translates the two screenplay
 * concepts ACP expresses differently: the approval gate becomes an ACP
 * *permission request*, and a `/stop` / supersession becomes ACP
 * *cancellation*.
 *
 * It is deliberately *below* the {@link import("./engine-seam").Engine} seam:
 * the later ACP Engine slice drives this module the way the in-process engine
 * drives `streamText`, then feeds its updates through the same
 * {@link import("./consumer").AcpUpdateConsumer}, so both engines reach
 * identical app state. Production transport hardening (process supervision,
 * reconnection backoff) lives above this module and is out of scope here.
 */

/**
 * The abstracted ACP transport. This is genuine ACP's own bidirectional
 * message {@link Stream}, given a domain name so the production transport and
 * the test transport are provably the *same* seam: production wraps a spawned
 * agent's stdio with `ndJsonStream` (or a socket), while tests cross a pair of
 * in-memory streams to a fake agent — with no live agent and no subprocess.
 * Which concrete transport backs it is an implementation detail this module
 * never fixes.
 */
export type AcpTransport = Stream

/**
 * A screenplay plan-mode decision. Mirrors run-state's `PlanResolution` (kept
 * structurally separate so this transport-pure module doesn't pull in the
 * `server-only`, database-bound run-state machine). `approved` resumes the
 * turn; a rejection revises it. `feedback` is carried by the *next* prompt, not
 * the permission response — ACP's response carries only the chosen option.
 */
export interface PlanDecision {
  approved: boolean
  feedback?: string
}

/** The side-effecting boundary an {@link AcpSession} drives as a turn runs. */
export interface AcpSessionPorts {
  /**
   * Forward each ACP `session/update` notification body as it streams. The ACP
   * Engine feeds these into the same {@link import("./consumer").AcpUpdateConsumer}
   * the in-process engine drives, so both produce identical broadcasts,
   * ACP-native records, and run-state transitions.
   */
  onUpdate(update: SessionUpdate): Promise<void> | void
  /**
   * The plan-mode pause — the riskiest seam (ADR 0006). An ACP permission
   * request is handed to screenplay's approval gate, which blocks until a human
   * decides. The session maps the {@link PlanDecision} back onto one of the
   * agent's offered options by ACP option *kind*, so approve resumes the turn
   * and reject revises it. Screenplay's approval gate maps onto ACP's
   * *permission request*, **not** its informational `plan` session update.
   */
  requestPlanApproval(request: RequestPermissionRequest): Promise<PlanDecision>
}

/** How {@link AcpSession.open} establishes the session after the handshake. */
export interface OpenSessionOptions {
  /** Working directory advertised to the agent (absolute path). */
  cwd: string
  /**
   * Resume an existing ACP session by id via `session/load` instead of creating
   * one via `session/new`. The agent must advertise the `loadSession`
   * capability for the load to succeed.
   */
  loadSessionId?: string
  /**
   * Open the session in the agent's plan mode. screenplay's plan-mode approval
   * gate only appears when the agent is *in* plan mode (spike #408): the Claude
   * adapter advertises a `plan` mode in `session/new`'s `modes`, and only after
   * `session/set_mode(plan)` does a plan-requesting turn raise the ExitPlanMode
   * permission request the gate maps onto. When `true` and the agent advertised
   * a matching mode, {@link AcpSession.open} switches into it; agents that don't
   * advertise modes are left untouched (the in-process engine drives plan mode
   * through the prompt instead).
   */
  planMode?: boolean
}

/**
 * The session-mode state an agent advertises in `session/new` / `session/load`
 * (a subset of ACP's `SessionModeState`): the modes it can operate in and the
 * one it's currently in. Kept structural so this module reads only what it
 * needs.
 */
interface SessionModes {
  availableModes: { id: string; name: string }[]
  currentModeId: string
}

/**
 * One live ACP conversation session over an {@link AcpTransport}. Construct it
 * with {@link AcpSession.open}, which performs the handshake and new-or-load and
 * returns a session already bound to its negotiated id.
 */
export class AcpSession {
  private readonly conn: ClientSideConnection
  private sessionId: string | null = null
  /**
   * The in-flight turn's abort signal, so a `/stop` arriving while a permission
   * request is outstanding answers `cancelled` (as the spec requires) rather
   * than waiting on a gate whose run is already terminal.
   */
  private activeSignal: AbortSignal | null = null

  private constructor(
    transport: AcpTransport,
    private readonly ports: AcpSessionPorts
  ) {
    this.conn = new ClientSideConnection(() => this.client(), transport)
  }

  /** The negotiated session id. Throws before {@link AcpSession.open} binds it. */
  get id(): string {
    if (!this.sessionId) throw new Error("ACP session is not initialized")
    return this.sessionId
  }

  /**
   * Open a session over `transport`: the ACP handshake/initialize, then either
   * `session/new` or — when {@link OpenSessionOptions.loadSessionId} is given —
   * `session/load`. Resolves once a live session id is bound.
   */
  static async open(
    transport: AcpTransport,
    ports: AcpSessionPorts,
    options: OpenSessionOptions
  ): Promise<AcpSession> {
    const session = new AcpSession(transport, ports)
    await session.conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    })
    if (options.loadSessionId) {
      const loaded = await session.conn.loadSession({
        sessionId: options.loadSessionId,
        cwd: options.cwd,
        mcpServers: [],
      })
      session.sessionId = options.loadSessionId
      await session.maybeEnterPlanMode(options.planMode, loaded?.modes)
    } else {
      const created = await session.conn.newSession({
        cwd: options.cwd,
        mcpServers: [],
      })
      session.sessionId = created.sessionId
      await session.maybeEnterPlanMode(options.planMode, created.modes)
    }
    return session
  }

  /**
   * Switch the agent into plan mode when the turn asked for it *and* the agent
   * advertised a plan-like mode (spike #408). A no-op otherwise — agents that
   * don't advertise modes, or that are already in the plan mode, are left as
   * they are, so a non-plan turn and a mode-less agent both pass through
   * untouched.
   */
  private async maybeEnterPlanMode(
    planMode: boolean | undefined,
    modes: SessionModes | null | undefined
  ): Promise<void> {
    if (!planMode || !modes) return
    const mode = modes.availableModes.find(isPlanMode)
    if (!mode || mode.id === modes.currentModeId) return
    await this.conn.setSessionMode({ sessionId: this.id, modeId: mode.id })
  }

  /**
   * Send one turn as an ACP `prompt`, resolving with its `stopReason` once the
   * agent reports the turn complete. `session/update` notifications stream to
   * {@link AcpSessionPorts.onUpdate} throughout. Aborting `signal` (a user
   * `/stop` or a supersession) sends an ACP `session/cancel`; the agent then
   * resolves the turn with `stopReason: "cancelled"`.
   */
  async prompt(
    blocks: ContentBlock[],
    signal: AbortSignal
  ): Promise<StopReason> {
    const sessionId = this.id
    this.activeSignal = signal
    // Queue the prompt first so the cancel notification (if the signal is
    // already aborted) is serialized *after* it on the connection's write
    // queue — otherwise a pre-aborted turn would cancel nothing and then run.
    const turn = this.conn.prompt({ sessionId, prompt: blocks })
    const cancel = () => void this.conn.cancel({ sessionId })
    if (signal.aborted) cancel()
    else signal.addEventListener("abort", cancel, { once: true })
    try {
      const { stopReason } = await turn
      return stopReason
    } finally {
      signal.removeEventListener("abort", cancel)
      this.activeSignal = null
    }
  }

  /** The {@link Client} half of the connection — where the agent calls back. */
  private client(): Client {
    return {
      sessionUpdate: async ({ sessionId, update }) => {
        // One connection drives one session (ADR 0006: the server is the single
        // ACP peer, one session per run), but guard the id anyway so a stray
        // notification can never bleed into another run's stream.
        if (sessionId !== this.sessionId) return
        await this.ports.onUpdate(update)
      },
      requestPermission: async (request) => ({
        outcome: await this.resolvePermission(request),
      }),
    }
  }

  private async resolvePermission(
    request: RequestPermissionRequest
  ): Promise<RequestPermissionResponse["outcome"]> {
    // The spec requires a `cancelled` outcome if the turn was cancelled while a
    // permission request was outstanding — honor it without troubling the gate.
    if (this.activeSignal?.aborted) return { outcome: "cancelled" }
    const decision = await this.ports.requestPlanApproval(request)
    if (this.activeSignal?.aborted) return { outcome: "cancelled" }
    const option = pickOption(request.options, decision.approved)
    return option
      ? { outcome: "selected", optionId: option.optionId }
      : { outcome: "cancelled" }
  }
}

/** Whether an advertised session mode is the agent's plan mode (id or name). */
function isPlanMode(mode: { id: string; name: string }): boolean {
  return mode.id === "plan" || /plan/i.test(mode.name)
}

/**
 * Map a screenplay approve/reject decision onto one of the agent's offered
 * permission options by ACP option *kind*: an approval takes an `allow_*`
 * option, a rejection a `reject_*` one. If the agent offered no option of the
 * decided polarity there is nothing honest to select, so the caller cancels
 * rather than silently pick the opposite.
 *
 * On approve, **`allow_once` is preferred over `allow_always`** (spike #408):
 * the real ExitPlanMode gate offers both, and `allow_always` ("auto-accept all
 * edits") would silently flip the session into accepting every later edit
 * unprompted — an approve of *this* plan must not also surrender the next gate.
 * The polarity prefix is the fallback so an agent that offers only an
 * `allow_always` (or only a `reject_always`) still resolves.
 */
function pickOption(
  options: PermissionOption[],
  approved: boolean
): PermissionOption | undefined {
  const exact = approved ? "allow_once" : "reject_once"
  const prefix = approved ? "allow" : "reject"
  return (
    options.find((option) => option.kind === exact) ??
    options.find((option) => option.kind.startsWith(prefix))
  )
}
