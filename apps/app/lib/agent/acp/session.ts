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
  /**
   * The chat's chosen model *within* the Harness, applied at session open via
   * ACP's native model selection (`unstable_setSessionModel`) — mirroring how
   * {@link planMode} drives `setSessionMode` off the advertised `modes` (#522,
   * #526). When the agent advertises this id in `availableModels`, the session
   * switches to it; when it doesn't (subscription tier changed, curated id
   * retired), the session **silently** falls back to the Harness default and
   * reconciles via {@link reconcileModel} — a model is a preference refinement,
   * not an identity, so a stale one never fails the turn (unlike a missing
   * Harness, which fails loud). Absent ⇒ no model call, the Harness runs its own
   * default. An adapter that advertises *no* models (codex — spike #523) takes
   * the no-op branch here; its model rode the spawn argv instead.
   */
  modelId?: string
  /**
   * Persist the resolved model id after a silent fallback (#526): called with
   * the *bare* in-Harness model id the session settled on (the Harness default)
   * when {@link modelId} was stale, so the chat's stored id stops re-tripping the
   * absent model on the next open. The codec re-encoding to `harness:<key>:<id>`
   * lives with the caller, which knows the key; absent ⇒ no reconciliation (e.g.
   * a chat the caller can't key on).
   */
  reconcileModel?(modelId: string): Promise<void> | void
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
 * The session-model state an agent advertises in `session/new` / `session/load`
 * (a subset of ACP's `unstable_`/`@experimental` `SessionModelState`): the
 * models it can run and the one currently active. Kept structural so this module
 * reads only what it needs, mirroring {@link SessionModes}. An adapter that
 * advertises no models (codex — spike #523) sends no state at all, which the
 * model-application path treats as "the Harness runs its own default".
 */
interface SessionModels {
  availableModels: { modelId: string }[]
  currentModelId: string
}

/** ACP/JSON-RPC internal-error code; an adapter returns it for a model it can't run. */
const INTERNAL_ERROR_CODE = -32603

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
  /** Persist a silently-resolved model id after a stale-model fallback (#526). */
  private reconcileModel?: (modelId: string) => Promise<void> | void
  /**
   * The Harness default to recover to if the model applied at open — advertised,
   * but possibly entitlement-stale — fails the first prompt with `-32603` (spike
   * #523: `setSessionModel` validates lazily, so a bad id only surfaces at prompt
   * time). `null` when no model was applied, so the prompt-time guard never fires
   * for a session running the Harness's own default.
   */
  private appliedModelFallback: string | null = null
  /** Guards the prompt-time model fallback to a single retry per session. */
  private modelRetried = false

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
    session.reconcileModel = options.reconcileModel
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
      await session.maybeSetModel(options.modelId, loaded?.models)
    } else {
      const created = await session.conn.newSession({
        cwd: options.cwd,
        mcpServers: [],
      })
      session.sessionId = created.sessionId
      await session.maybeEnterPlanMode(options.planMode, created.modes)
      await session.maybeSetModel(options.modelId, created.models)
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
   * Apply the chat's chosen model when the turn carries one (#522, #526) — the
   * model counterpart of {@link maybeEnterPlanMode}. Three cases:
   *
   *  - no `modelId`, or the agent sends no model state (codex — spike #523): no
   *    call, the Harness runs its own default (codex took its model at spawn);
   *  - `modelId` is the current model already: no call;
   *  - otherwise: `unstable_setSessionModel` forwards it, and we remember the
   *    Harness default to recover to if the *first prompt* rejects it.
   *
   * We forward the id **without gating on `availableModels`**. The adapter honors
   * a much richer id space than it advertises — `setSessionModel` accepts aliases
   * and full slugs the advertised list omits, and validates lazily (spike #523),
   * so a bad id only surfaces at the first prompt as `-32603`. Gating on the
   * under-reported `availableModels` would silently suppress valid models (a
   * curated `opus`/`fable` that the adapter accepts but doesn't list), reconciling
   * the user's choice away to the default for no reason. So we apply it and let
   * the prompt-time fallback ({@link prompt} → {@link fallBackToDefaultModel}) be
   * the single arbiter of validity: a genuinely stale id fails the first prompt,
   * recovers to the default, reconciles the stored id, and retries once — the same
   * silent recovery, just driven by the agent's verdict rather than a guess from
   * its advertised list.
   */
  private async maybeSetModel(
    modelId: string | undefined,
    models: SessionModels | null | undefined
  ): Promise<void> {
    if (!modelId || !models) return
    if (modelId === models.currentModelId) return
    await this.conn.unstable_setSessionModel({ sessionId: this.id, modelId })
    this.appliedModelFallback = models.currentModelId
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
    try {
      return await this.sendTurn(blocks, signal)
    } catch (e) {
      // The model applied at open turned out invalid — unentitled, or an id the
      // agent doesn't accept (we forward without gating on `availableModels`, so
      // this path is the single arbiter of validity). It validates lazily, so the
      // agent rejects the *first* prompt with `-32603` rather than the
      // `setSessionModel` call (spike #523). Silently recover to the Harness
      // default, reconcile the stored id, and retry once, so a stale model
      // preference never surfaces as a hard turn error (#526, story #6). Every
      // other error — and a second model failure — propagates to the engine
      // unchanged.
      if (!this.canRecoverModel(e, signal)) throw e
      await this.fallBackToDefaultModel()
      return await this.sendTurn(blocks, signal)
    }
  }

  /** Send one turn as an ACP `prompt`, wiring `/stop` cancellation for it. */
  private async sendTurn(
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

  /**
   * Whether a failed turn is the lazy-validation model rejection we can silently
   * recover from: a model was applied this session, we haven't already retried,
   * the turn wasn't stopped, and the error is the adapter's internal-error code
   * naming the model (spike #523). Narrow on purpose — a generic internal error
   * or a `/stop` must still surface, never be masked as a model fallback.
   */
  private canRecoverModel(e: unknown, signal: AbortSignal): boolean {
    return (
      this.appliedModelFallback !== null &&
      !this.modelRetried &&
      !signal.aborted &&
      isStaleModelError(e)
    )
  }

  /** Switch back to the Harness default, reconcile the stored id, and disarm the guard. */
  private async fallBackToDefaultModel(): Promise<void> {
    const fallback = this.appliedModelFallback!
    this.modelRetried = true
    this.appliedModelFallback = null
    await this.conn.unstable_setSessionModel({
      sessionId: this.id,
      modelId: fallback,
    })
    await this.reconcileModel?.(fallback)
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
 * Whether a thrown error is an adapter rejecting the selected model on a prompt
 * turn (spike #523): the ACP/JSON-RPC internal-error code whose message names
 * the model ("issue with the selected model … may not exist or you may not have
 * access"). Both signals are required so an unrelated internal error isn't
 * mistaken for a stale model and silently retried.
 */
function isStaleModelError(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false
  if ((e as { code?: unknown }).code !== INTERNAL_ERROR_CODE) return false
  const message = (e as { message?: unknown }).message
  return typeof message === "string" && /model/i.test(message)
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
