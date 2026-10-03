import {
  ClientSideConnection,
  PROTOCOL_VERSION,
  type Client,
  type ContentBlock,
  type McpServer,
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

/**
 * What the session needs to know about the adapter behind it, stated on its
 * Harness descriptor (`AcpAdapter` in `harnesses/types`) rather than detected
 * from what the adapter advertises. Absent fields take the generic default.
 */
export interface AdapterFacts {
  /**
   * The id of the config option the adapter takes the model through. Absent ⇒
   * the option ACP marks with the `"model"` category.
   */
  modelOption?: string
  /** Whether the adapter queues a prompt sent while one runs (#1191). */
  promptQueueing?: boolean
}

/** How {@link AcpSession.open} establishes the session after the handshake. */
export interface OpenSessionOptions {
  /** The adapter's Harness facts (see {@link AdapterFacts}). */
  adapter?: AdapterFacts
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
   *
   * An agent with no plan mode may plan through a `collaboration_mode` config
   * option instead (Codex's adapter, #1337): a plan turn sets it to `plan`, and
   * any other turn sets it back to its default, since the setting carries over
   * to later turns of the session. See {@link AcpSession.plansByCollaborationMode}.
   */
  planMode?: boolean
  /**
   * The chat's chosen model *within* the Harness, applied at session open via
   * ACP's generic config-option selector (`session/set_config_option` on the
   * option whose `category` is `"model"`) — mirroring how {@link planMode} drives
   * `setSessionMode` off the advertised `modes` (#522, #526). SDK 1.x replaced
   * the experimental `unstable_setSessionModel` with this per-option mechanism
   * (#638). When the agent advertises a model option, the session switches to
   * this id; when the id turns out stale (subscription tier changed, curated id
   * retired), the session **silently** falls back to the Harness default and
   * reconciles via {@link reconcileModel} — a model is a preference refinement,
   * not an identity, so a stale one never fails the turn (unlike a missing
   * Harness, which fails loud). Absent ⇒ no model call, the Harness runs its own
   * default. An adapter that advertises *no* model option takes the no-op
   * branch here.
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
  /**
   * MCP servers handed to the agent, sent on **both** `session/new` and
   * `session/load`: an adapter rebuilds its tool set from the load-time list,
   * so a load that sent `[]` would resume with no tools (#903). An `http` entry
   * is dropped when the agent doesn't advertise `mcpCapabilities.http`, as the
   * spec requires. Absent ⇒ `[]`.
   */
  mcpServers?: McpServer[]
  /**
   * Adapter-specific `_meta` sent with `session/new` and `session/load`. The
   * Claude adapter reads `claudeCode.options` from it (the Coordinator's
   * `allowedTools`); other adapters ignore keys they don't know.
   */
  sessionMeta?: Record<string, unknown>
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
 * One model an agent advertises for a session — the ACP `value` id to select it
 * (e.g. `"opus"`), its human-readable `name`, and any `description`. This is the
 * public shape {@link AcpSession.availableModels} exposes so a caller can list
 * the models the *current build's* adapter actually offers, without re-deriving
 * them from the Harness catalog.
 */
export interface AvailableModel {
  /** The value id passed to `session/set_config_option` (e.g. `"opus"`). */
  id: string
  /** Human-readable label the agent advertises (e.g. `"Opus 4.8"`). */
  name: string
  /** Optional longer description the agent advertises for the model. */
  description?: string
}

/**
 * The model selector an agent advertises in its `session/new` / `session/load`
 * `configOptions` (SDK 1.x's generic `SessionConfigOption` mechanism — the
 * successor to the retired experimental `SessionModelState`). We read only what
 * the model-application path needs: the option's `configId` (to target
 * `session/set_config_option`), the value currently active, and the models it
 * offers. Kept structural so this module reads only what it needs, mirroring
 * {@link SessionModes}. An agent that advertises no model option yields `null`, which the model-application path treats as "the Harness
 * runs its own default".
 */
interface ModelConfig {
  configId: string
  currentValue: string
  available: AvailableModel[]
}

/**
 * The config option an agent with no plan mode plans through (Codex's adapter,
 * #1337): a `select` in this category, or with this id, offering
 * {@link PLAN_COLLABORATION_MODE}.
 */
const COLLABORATION_MODE = "collaboration_mode"
/** The collaboration-mode value that plans before making changes. */
const PLAN_COLLABORATION_MODE = "plan"
/** The value a non-plan turn sets it back to, when the agent offers it. */
const DEFAULT_COLLABORATION_MODE = "default"

/** ACP config-option category the spec reserves for the model selector. */
const MODEL_CATEGORY = "model"
/** Conventional option id the Claude adapter gives its model selector. */
const MODEL_OPTION_ID = "model"

/** ACP/JSON-RPC internal-error code; an adapter returns it for a model it can't run. */
const INTERNAL_ERROR_CODE = -32603
/** JSON-RPC invalid-params code; codex's adapter returns it for a model it doesn't offer. */
const INVALID_PARAMS_CODE = -32602

/**
 * The structural slice of an advertised `configOptions` entry this module reads.
 * A single-value `select` carries a `currentValue` and its `options` (each a
 * value, or a group of values); other option types (a boolean toggle) carry no
 * `options` and are ignored by {@link readModelConfig}.
 */
interface ConfigOptionLike {
  id: string
  category?: string | null
  type?: string
  currentValue?: unknown
  options?: unknown
}

/**
 * Pull the model selector out of an agent's advertised `configOptions`, or
 * `null` when it advertises none (a mode/effort-only agent). The option the
 * Harness descriptor names (`optionId`) wins; otherwise it is recognised by
 * ACP's reserved `"model"` category, falling back to the conventional `"model"`
 * option id. Only a single-value `select` with a string `currentValue`
 * qualifies; its value groups are flattened so a grouped selector reads the
 * same as a flat one.
 */
function readModelConfig(
  configOptions: ConfigOptionLike[] | null | undefined,
  optionId: string | undefined
): ModelConfig | null {
  const option =
    (optionId ? configOptions?.find((o) => o.id === optionId) : undefined) ??
    configOptions?.find(
      (o) => o.category === MODEL_CATEGORY || o.id === MODEL_OPTION_ID
    )
  if (!option || typeof option.currentValue !== "string") return null
  if (!Array.isArray(option.options)) return null
  const available = flattenModelOptions(option.options)
  return { configId: option.id, currentValue: option.currentValue, available }
}

/**
 * Flatten a selector's `options` — an array of value entries, or of groups each
 * holding value entries — into the flat {@link AvailableModel} list. Entries
 * without a string `value` are skipped defensively.
 */
function flattenModelOptions(options: unknown[]): AvailableModel[] {
  const models: AvailableModel[] = []
  for (const entry of options) {
    if (typeof entry !== "object" || entry === null) continue
    const e = entry as {
      value?: unknown
      name?: unknown
      description?: unknown
      options?: unknown
    }
    if (Array.isArray(e.options)) {
      models.push(...flattenModelOptions(e.options))
      continue
    }
    if (typeof e.value !== "string") continue
    models.push({
      id: e.value,
      name: typeof e.name === "string" ? e.name : e.value,
      ...(typeof e.description === "string"
        ? { description: e.description }
        : {}),
    })
  }
  return models
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
  /** Persist a silently-resolved model id after a stale-model fallback (#526). */
  private reconcileModel?: (modelId: string) => Promise<void> | void
  /**
   * The Harness default to recover to if the model applied at open — advertised,
   * but possibly entitlement-stale — fails the first prompt with `-32603` (spike
   * #523: the selector validates lazily, so a bad id only surfaces at prompt
   * time). `null` when no model was applied, so the prompt-time guard never fires
   * for a session running the Harness's own default.
   */
  private appliedModelFallback: string | null = null
  /**
   * The `configId` of the agent's model selector, remembered from the advertised
   * `configOptions` so the prompt-time fallback can target the same option
   * (`session/set_config_option`) without re-reading the session response.
   * `null` when the agent advertised no model option.
   */
  private modelConfigId: string | null = null
  /** Guards the prompt-time model fallback to a single retry per session. */
  private modelRetried = false
  /** Models the agent advertised for this session (see {@link availableModels}). */
  private modelChoices: AvailableModel[] = []
  /** Ends the agent behind the transport (see {@link close}). */
  private closer: (() => void) | null = null
  /** Whether the adapter queues prompts (see {@link promptQueueing}). */
  private queuesPrompts = false
  /** Whether the agent advertised a steering request (see {@link steering}). */
  private takesSteering = false
  /**
   * Whether the agent takes image blocks in a prompt (its
   * `promptCapabilities.image`). An attached image (#1525) is dropped for one
   * that doesn't; the message's footer still names the file.
   */
  private takesImages = false
  /** Prompts sent and not yet resolved; the turn signal is cleared at zero. */
  private outstanding = 0
  /** Whether this turn plans through the collaboration mode (see the getter). */
  private collaborationPlan = false

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
   * The models the agent advertised for this session, in advertised order —
   * captured at {@link AcpSession.open} from the model config option. Empty when
   * the agent advertises no model option, or before the
   * session is opened. This is the "what models does the current build offer?"
   * mechanism (#638): the list reflects the *actually-spawned* adapter, not the
   * static Harness catalog, so a build whose adapter gained or dropped a model is
   * visible here without a catalog change.
   */
  get availableModels(): AvailableModel[] {
    return this.modelChoices
  }

  /**
   * Whether the agent takes a further `session/prompt` while one is running
   * (#1191), as its Harness descriptor states ({@link AdapterFacts}): the
   * Claude adapter pushes the new prompt into the live turn, the way a message
   * typed while Claude Code works joins it in its own terminal. The earlier
   * prompt then resolves `end_turn` at the handoff, and the newest one resolves
   * when the agent is done. False for any adapter whose descriptor doesn't say so.
   */
  get promptQueueing(): boolean {
    return this.queuesPrompts
  }

  /**
   * Whether the agent takes a mid-turn message through a steering request
   * (#1192): Codex's adapter advertises `_meta.steering.supported` at
   * initialize and answers {@link steer}. False for any agent that doesn't.
   */
  get steering(): boolean {
    return this.takesSteering
  }

  /**
   * Whether this session was opened for a plan turn on an agent that plans
   * through its `collaboration_mode` option rather than a plan mode (Codex's
   * adapter, #1337). Such an agent asks to carry out its finished plan with a
   * permission request whose `rawInput.plan` holds the plan, and that request
   * alone is the plan gate; it may raise ordinary permission requests on the
   * same turn too.
   */
  get plansByCollaborationMode(): boolean {
    return this.collaborationPlan
  }

  /**
   * Set how {@link close} ends the agent: the factory that spawned it kills
   * its process. A session with none (an in-memory test agent) closes as a
   * no-op.
   */
  onClose(closer: () => void): void {
    this.closer = closer
  }

  /**
   * End the agent behind this session, whatever it is still doing. Used when
   * a stopped turn's agent may not have wound down (#1191).
   */
  close(): void {
    const closer = this.closer
    this.closer = null
    closer?.()
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
    const init = await session.conn.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
    })
    session.queuesPrompts = options.adapter?.promptQueueing === true
    session.takesSteering =
      advertisesSteering(init._meta) ||
      advertisesSteering(init.agentCapabilities?._meta)
    session.takesImages =
      init.agentCapabilities?.promptCapabilities?.image === true
    const mcpServers = supportedMcpServers(
      options.mcpServers ?? [],
      init.agentCapabilities?.mcpCapabilities
    )
    const meta = options.sessionMeta ? { _meta: options.sessionMeta } : {}
    if (options.loadSessionId) {
      const loaded = await session.conn.loadSession({
        sessionId: options.loadSessionId,
        cwd: options.cwd,
        mcpServers,
        ...meta,
      })
      session.sessionId = options.loadSessionId
      await session.applyPlanMode(
        options.planMode,
        loaded?.modes,
        loaded?.configOptions
      )
      await session.maybeSetModel(
        options.modelId,
        readModelConfig(loaded?.configOptions, options.adapter?.modelOption)
      )
    } else {
      const created = await session.conn.newSession({
        cwd: options.cwd,
        mcpServers,
        ...meta,
      })
      session.sessionId = created.sessionId
      await session.applyPlanMode(
        options.planMode,
        created.modes,
        created.configOptions
      )
      await session.maybeSetModel(
        options.modelId,
        readModelConfig(created.configOptions, options.adapter?.modelOption)
      )
    }
    return session
  }

  /**
   * Put the agent in or out of planning for this turn.
   *
   * An agent that advertises a plan-like mode (spike #408) is switched into it
   * on a plan turn, and left as it is otherwise. One that advertises none but
   * offers a `plan` collaboration mode (Codex's adapter, #1337) has that option
   * set to `plan` on a plan turn and back to its default on any other turn
   * when a resumed session is still planning, since the option carries over to
   * later turns. An agent with neither passes through untouched.
   */
  private async applyPlanMode(
    planMode: boolean | undefined,
    modes: SessionModes | null | undefined,
    configOptions: ConfigOptionLike[] | null | undefined
  ): Promise<void> {
    const mode = modes?.availableModes.find(isPlanMode)
    if (mode) {
      if (!planMode || mode.id === modes!.currentModeId) return
      await this.conn.setSessionMode({ sessionId: this.id, modeId: mode.id })
      return
    }
    const collaboration = readCollaborationMode(configOptions)
    if (!collaboration) return
    this.collaborationPlan = planMode === true
    const value = planMode
      ? PLAN_COLLABORATION_MODE
      : collaboration.defaultValue
    if (value === null || value === collaboration.currentValue) return
    await this.conn.setSessionConfigOption({
      sessionId: this.id,
      configId: collaboration.configId,
      value,
    })
  }

  /**
   * Apply the chat's chosen model when the turn carries one (#522, #526) — the
   * model counterpart of {@link applyPlanMode}. First captures the advertised
   * model list (for {@link availableModels}) and the selector's `configId`, then:
   *
   *  - no model option advertised: no call, the Harness runs its own default;
   *  - no `modelId`: no call, the Harness runs its own default;
   *  - `modelId` is the current model already: no call;
   *  - otherwise: `session/set_config_option` forwards it, and we remember the
   *    Harness default to recover to if the *first prompt* rejects it.
   *
   * We forward the id **without gating on the advertised list**. The adapter
   * honors a much richer id space than it advertises — the selector accepts
   * aliases and full slugs the advertised list omits, and validates lazily (spike
   * #523), so a bad id only surfaces at the first prompt as `-32603`. Gating on the
   * under-reported list would silently suppress valid models (a curated
   * `opus`/`fable` that the adapter accepts but doesn't list), reconciling the
   * user's choice away to the default for no reason. So we apply it and let the
   * prompt-time fallback ({@link prompt} → {@link fallBackToDefaultModel}) be the
   * single arbiter of validity: a genuinely stale id fails the first prompt,
   * recovers to the default, reconciles the stored id, and retries once — the same
   * silent recovery, just driven by the agent's verdict rather than a guess from
   * its advertised list.
   *
   * Codex's adapter validates eagerly instead (#1271): it rejects an id it
   * doesn't offer on the `set_config_option` call itself with invalid params.
   * That is the same verdict arriving earlier, so it gets the same silent
   * recovery: the session stays on the Harness default and the stored id is
   * reconciled to it.
   */
  private async maybeSetModel(
    modelId: string | undefined,
    model: ModelConfig | null
  ): Promise<void> {
    if (!model) return
    // Capture the advertised list and the selector id even when no model is
    // applied, so `availableModels` and a later fallback both have what they need.
    this.modelChoices = model.available
    this.modelConfigId = model.configId
    if (!modelId) return
    if (modelId === model.currentValue) return
    try {
      await this.conn.setSessionConfigOption({
        sessionId: this.id,
        configId: model.configId,
        value: modelId,
      })
    } catch (e) {
      if (!isRejectedModelError(e)) throw e
      await this.reconcileModel?.(model.currentValue)
      return
    }
    this.appliedModelFallback = model.currentValue
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
      // agent doesn't accept (we forward without gating on the advertised list, so
      // this path is the single arbiter of validity). It validates lazily, so the
      // agent rejects the *first* prompt with `-32603` rather than the
      // `set_config_option` call (spike #523). Silently recover to the Harness
      // default, reconcile the stored id, and retry once, so a stale model
      // preference never surfaces as a hard turn error (#526, story #6). Every
      // other error — and a second model failure — propagates to the engine
      // unchanged.
      if (!this.canRecoverModel(e, signal)) throw e
      await this.fallBackToDefaultModel()
      return await this.sendTurn(blocks, signal)
    }
  }

  /**
   * Send a message into the running turn through the agent's steering request
   * (`_session/steering`, #1192). The agent answers `injected` when the message
   * joined the running turn, `startedNewTurn` when that turn had already ended
   * and the message began another one (which streams like any turn but has no
   * prompt of ours to resolve), and `failed` when it couldn't take it. An error
   * or an answer it doesn't recognise counts as `failed`: the caller still
   * holds the message and can send it another way.
   */
  async steer(blocks: ContentBlock[]): Promise<SteerOutcome> {
    try {
      const response = await this.conn.request<{ outcome?: unknown }>(
        STEERING_METHOD,
        { sessionId: this.id, prompt: this.promptable(blocks) }
      )
      const outcome = response?.outcome
      return outcome === "injected" || outcome === "startedNewTurn"
        ? outcome
        : "failed"
    } catch {
      return "failed"
    }
  }

  /**
   * Cancel whatever the agent is running now (ACP `session/cancel`). A prompt
   * of ours is cancelled through its own signal; this is for a turn the agent
   * started itself, such as one a Steer began (#1192).
   */
  cancel(): void {
    void this.conn.cancel({ sessionId: this.id }).catch(() => {})
  }

  /** Send one turn as an ACP `prompt`, wiring `/stop` cancellation for it. */
  /** `blocks` without the image blocks an agent that takes none would refuse. */
  private promptable(blocks: ContentBlock[]): ContentBlock[] {
    return this.takesImages ? blocks : blocks.filter((b) => b.type !== "image")
  }

  private async sendTurn(
    blocks: ContentBlock[],
    signal: AbortSignal
  ): Promise<StopReason> {
    const sessionId = this.id
    this.activeSignal = signal
    this.outstanding++
    // Queue the prompt first so the cancel notification (if the signal is
    // already aborted) is serialized *after* it on the connection's write
    // queue — otherwise a pre-aborted turn would cancel nothing and then run.
    const turn = this.conn.prompt({
      sessionId,
      prompt: this.promptable(blocks),
    })
    const cancel = () => void this.conn.cancel({ sessionId })
    if (signal.aborted) cancel()
    else signal.addEventListener("abort", cancel, { once: true })
    try {
      const { stopReason } = await turn
      return stopReason
    } finally {
      signal.removeEventListener("abort", cancel)
      // A queued prompt (#1191) shares the turn's signal; keep it until the
      // last one is over.
      if (--this.outstanding === 0) this.activeSignal = null
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
    await this.conn.setSessionConfigOption({
      sessionId: this.id,
      configId: this.modelConfigId!,
      value: fallback,
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

/** The agent's steering request (Codex's adapter, #1192). */
const STEERING_METHOD = "_session/steering"

/** How the agent answered a {@link AcpSession.steer}. */
export type SteerOutcome = "injected" | "startedNewTurn" | "failed"

/**
 * Whether initialize advertised the steering request: `_meta.steering.supported`
 * (`@agentclientprotocol/codex-acp` 2.x puts it on the response, beside the
 * capabilities; either place counts). It is the adapter's own `_meta`, not a
 * standard ACP capability.
 */
function advertisesSteering(
  meta: { [key: string]: unknown } | null | undefined
): boolean {
  const steering = meta?.steering
  return (
    typeof steering === "object" &&
    steering !== null &&
    (steering as { supported?: unknown }).supported === true
  )
}

/**
 * The MCP servers an agent can take: stdio always (the spec requires it), and
 * `http` / `sse` only when the agent advertised that transport.
 */
function supportedMcpServers(
  servers: McpServer[],
  capabilities: { http?: boolean; sse?: boolean } | null | undefined
): McpServer[] {
  return servers.filter((server) => {
    if (!("type" in server)) return true
    if (server.type === "http") return capabilities?.http === true
    if (server.type === "sse") return capabilities?.sse === true
    return false
  })
}

/**
 * The `collaboration_mode` option an agent advertises, when it offers a `plan`
 * value (#1337), or null. `defaultValue` is what a non-plan turn sets it back
 * to: its `default` value, else the first value that isn't `plan`.
 */
function readCollaborationMode(
  configOptions: ConfigOptionLike[] | null | undefined
): {
  configId: string
  currentValue: string
  defaultValue: string | null
} | null {
  const option = configOptions?.find(
    (o) => o.category === COLLABORATION_MODE || o.id === COLLABORATION_MODE
  )
  if (!option || typeof option.currentValue !== "string") return null
  if (!Array.isArray(option.options)) return null
  const values = flattenModelOptions(option.options).map((v) => v.id)
  if (!values.includes(PLAN_COLLABORATION_MODE)) return null
  const defaultValue = values.includes(DEFAULT_COLLABORATION_MODE)
    ? DEFAULT_COLLABORATION_MODE
    : (values.find((v) => v !== PLAN_COLLABORATION_MODE) ?? null)
  return {
    configId: option.id,
    currentValue: option.currentValue,
    defaultValue,
  }
}

/** Whether an advertised session mode is the agent's plan mode (id or name). */
function isPlanMode(mode: { id: string; name: string }): boolean {
  return mode.id === "plan" || /plan/i.test(mode.name)
}

/**
 * Whether a `set_config_option` call failed because the agent doesn't offer the
 * model (codex's eager check, #1271). Only invalid params qualifies; any other
 * failure still fails the open.
 */
function isRejectedModelError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: unknown }).code === INVALID_PARAMS_CODE
  )
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
