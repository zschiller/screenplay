import type { AcpAdapter, PlanStyle } from "../harnesses/types"
import {
  blockText,
  planFromPermissionRequest,
  planPermissionRequest,
  type RequestPermissionRequest,
  type SessionUpdate,
} from "./schema"

/**
 * How an ACP agent plans, as one module per way (#1665). screenplay's plan
 * gate is asynchronous: the agent's turn ends on a plan, the human reviews it
 * later, and the resume arrives as a new run. Each Harness reaches that gate
 * differently:
 *
 *  - **Native plan mode** (Claude Code, spike #408): the session switches into
 *    the agent's `plan` mode, and on a plan turn every permission request is
 *    its request to leave plan mode, the gate.
 *  - **Collaboration mode** (Codex, #1337): a `collaboration_mode` config
 *    option set to `plan`. Only the request carrying the plan in
 *    `rawInput.plan` is the gate; the agent's other requests are ordinary tool
 *    approvals. It also sends the plan as a reply just before asking, which
 *    the gate already shows, so that reply is held back.
 *  - **Reply as plan** (opencode, #1589): a `mode` config option set to
 *    `plan`, whose agent ends the turn with the plan as its answer and never
 *    asks to carry it out. The last reply is held and raised as the gate when
 *    the turn completes.
 *
 * {@link choosePlanProtocol} picks one per session from the Harness
 * descriptor and what the agent advertises; the session opens with it and the
 * External Engine drives each turn through its {@link PlanTurn} hooks.
 */
export interface PlanProtocol {
  readonly style: PlanStyle
  /**
   * Put the agent in or out of planning as the session opens. A plan mode is
   * entered on a plan turn and otherwise left as it is; a config option is
   * set to `plan` on a plan turn and back to its default on any other, since
   * the setting carries over to later turns of a resumed session.
   */
  open(planTurn: boolean, controls: PlanControls): Promise<void>
  /** The hooks for one turn of the session. */
  turn(context: PlanTurnContext): PlanTurn
}

/** The session calls a {@link PlanProtocol} switches the agent with. */
export interface PlanControls {
  setMode(modeId: string): Promise<void>
  setOption(configId: string, value: string): Promise<void>
}

/** What a turn's {@link PlanTurn} needs to know. */
export interface PlanTurnContext {
  /** Whether this turn plans (`EngineTurn.planMode`). */
  planTurn: boolean
  /** The run, which keeps a raised gate's tool call id unique. */
  runId: string
  /** The ACP session the gate's permission request belongs to. */
  sessionId: string
}

/** How a turn answers a permission request the agent raises. */
export type PlanPermission =
  /** An ordinary tool approval: allowed, so the tool runs to completion. */
  | { gate: false }
  /**
   * The plan gate: send `updates`, then raise `request` to the consumer,
   * which pauses the run; the live turn then winds down.
   */
  | { gate: true; updates: SessionUpdate[]; request: RequestPermissionRequest }

/** How a turn ends, once the agent is done with it. */
export interface PlanEnd {
  /** Updates still held, to send now. */
  updates: SessionUpdate[]
  /** The plan gate to raise after them, when the turn ends on its plan. */
  gate: RequestPermissionRequest | null
}

/** The per-turn hooks of a {@link PlanProtocol}. */
export interface PlanTurn {
  /** Gate on a permission request, or allow it. */
  permission(request: RequestPermissionRequest): PlanPermission
  /** The updates to send now that `update` arrived; some may be held. */
  update(update: SessionUpdate): SessionUpdate[]
  /**
   * The turn is over. `completed` when the agent ended it itself
   * (`end_turn`, not stopped); a stopped or failed turn never raises a gate
   * and only releases what is held.
   */
  end(completed: boolean): PlanEnd
}

/** A session mode an agent advertises (a subset of ACP's `SessionModeState`). */
export interface AdvertisedModes {
  availableModes: { id: string; name: string }[]
  currentModeId: string
}

/**
 * The structural slice of an advertised `configOptions` entry the plan and
 * model selectors read. A single-value `select` carries a `currentValue` and
 * its `options` (each a value, or a group of values).
 */
export interface ConfigOptionLike {
  id: string
  category?: string | null
  type?: string
  currentValue?: unknown
  options?: unknown
}

/** What an agent advertised for its session in `session/new` / `session/load`. */
export interface AdvertisedPlanOptions {
  modes?: AdvertisedModes | null
  configOptions?: ConfigOptionLike[] | null
}

/**
 * The config option an agent with no plan mode plans through (Codex's
 * adapter, #1337): a `select` in this category, or with this id, offering
 * {@link PLAN_VALUE}.
 */
const COLLABORATION_MODE = "collaboration_mode"
/**
 * ACP's config-option category for a session mode selector. opencode's
 * adapter offers its agents through one (`build`, `plan`) rather than through
 * `modes` (#1589).
 */
const MODE_CATEGORY = "mode"
/** The option value that plans before making changes. */
const PLAN_VALUE = "plan"
/** The value a non-plan turn sets it back to, when the agent offers it. */
const DEFAULT_VALUE = "default"

/**
 * Pick how a session plans, once, as it opens. The Harness descriptor's
 * {@link AcpAdapter.plan} wins over what the agent advertises, since it is
 * the stated fact; the advertised plan mode or option is only where the
 * protocol switches the agent, and a protocol with none to switch still
 * gates as its style does. An agent whose descriptor states nothing is read
 * from what it advertises: a plan mode first, else a plan config option.
 * Null when it neither states nor advertises a way to plan.
 */
export function choosePlanProtocol(
  advertised: AdvertisedPlanOptions,
  adapter?: Pick<AcpAdapter, "plan">
): PlanProtocol | null {
  const mode = advertised.modes?.availableModes.find(isPlanMode) ?? null
  const option = readPlanOption(advertised.configOptions)
  const style: PlanStyle | null =
    adapter?.plan ?? (mode ? "mode" : option ? "collaboration" : null)
  if (style === "mode") {
    return nativePlanMode(
      mode && { id: mode.id, current: advertised.modes!.currentModeId }
    )
  }
  if (style === "collaboration") return collaborationMode(option)
  if (style === "reply") return replyAsPlan(option)
  return null
}

/** The agent's plan mode, when it advertised one, and the mode it is in. */
interface PlanModeState {
  id: string
  current: string
}

/**
 * Native plan mode (spike #408): the gate is the agent's request to leave
 * plan mode, so on a plan turn every permission request is the gate.
 */
export function nativePlanMode(mode: PlanModeState | null): PlanProtocol {
  return {
    style: "mode",
    async open(planTurn, controls) {
      if (!planTurn || !mode || mode.id === mode.current) return
      await controls.setMode(mode.id)
    },
    turn({ planTurn }) {
      if (!planTurn) return PASS_THROUGH
      return {
        permission: (request) => ({ gate: true, updates: [], request }),
        update: (update) => [update],
        end: () => ({ updates: [], gate: null }),
      }
    },
  }
}

/** A plan config option, its current value and what a non-plan turn sets. */
interface PlanOption {
  configId: string
  currentValue: string
  defaultValue: string | null
}

/**
 * Collaboration mode (#1337): only the request carrying the plan in
 * `rawInput.plan` is the gate, raised as screenplay's own plan request; the
 * reply that repeats the plan just before it is held back.
 */
export function collaborationMode(option: PlanOption | null): PlanProtocol {
  return {
    style: "collaboration",
    open: (planTurn, controls) => setPlanOption(option, planTurn, controls),
    turn({ planTurn, runId }) {
      if (!planTurn) return PASS_THROUGH
      const held = new HeldReply()
      return {
        permission(request) {
          if (!asksToCarryOutPlan(request)) return { gate: false }
          const { plan } = planFromPermissionRequest(request)
          return {
            gate: true,
            updates: held.withoutPlan(plan),
            request: planPermissionRequest({
              sessionId: request.sessionId,
              // The pending plan is stored under its tool call id, so the run
              // id keeps it unique when the agent reuses item ids across
              // sessions.
              toolCallId: `${runId}:${request.toolCall.toolCallId}`,
              plan,
            }),
          }
        },
        update: (update) => held.take(update),
        end: () => ({ updates: held.release(), gate: null }),
      }
    },
  }
}

/**
 * Reply as plan (#1589): every permission request is an ordinary one, and a
 * plan turn that completes raises its last reply as the gate instead of
 * showing it. A turn that ends on a tool call, or is stopped, ends as usual.
 */
export function replyAsPlan(option: PlanOption | null): PlanProtocol {
  return {
    style: "reply",
    open: (planTurn, controls) => setPlanOption(option, planTurn, controls),
    turn({ planTurn, runId, sessionId }) {
      if (!planTurn) return PASS_THROUGH
      const held = new HeldReply()
      return {
        permission: () => ({ gate: false }),
        update: (update) => held.take(update),
        end(completed) {
          const plan = held.text().trim()
          if (!completed || !plan)
            return { updates: held.release(), gate: null }
          held.release()
          return {
            updates: [],
            gate: planPermissionRequest({
              sessionId,
              toolCallId: `${runId}:plan`,
              plan,
            }),
          }
        },
      }
    },
  }
}

/** A turn that doesn't plan: everything allowed, nothing held. */
const PASS_THROUGH: PlanTurn = {
  permission: () => ({ gate: false }),
  update: (update) => [update],
  end: () => ({ updates: [], gate: null }),
}

/** The turn of a session with no plan protocol, or before one is open. */
export const NO_PLAN_TURN: PlanTurn = PASS_THROUGH

/** Set a plan config option to `plan`, or back to its default. */
async function setPlanOption(
  option: PlanOption | null,
  planTurn: boolean,
  controls: PlanControls
): Promise<void> {
  if (!option) return
  const value = planTurn ? PLAN_VALUE : option.defaultValue
  if (value === null || value === option.currentValue) return
  await controls.setOption(option.configId, value)
}

/**
 * The `collaboration_mode` option an agent advertises, when it offers a `plan`
 * value (#1337), or else its `mode`-category option offering one (opencode's
 * agents, #1589), or null. `defaultValue` is what a non-plan turn sets it back
 * to: its `default` value, else the first value that isn't `plan`.
 */
function readPlanOption(
  configOptions: ConfigOptionLike[] | null | undefined
): PlanOption | null {
  const option =
    configOptions?.find(
      (o) => o.category === COLLABORATION_MODE || o.id === COLLABORATION_MODE
    ) ?? configOptions?.find((o) => o.category === MODE_CATEGORY)
  if (!option || typeof option.currentValue !== "string") return null
  if (!Array.isArray(option.options)) return null
  const values = optionValues(option.options)
  if (!values.includes(PLAN_VALUE)) return null
  const defaultValue = values.includes(DEFAULT_VALUE)
    ? DEFAULT_VALUE
    : (values.find((v) => v !== PLAN_VALUE) ?? null)
  return {
    configId: option.id,
    currentValue: option.currentValue,
    defaultValue,
  }
}

/** A select option's values, its groups flattened. */
function optionValues(options: unknown[]): string[] {
  return options.flatMap((entry): string[] => {
    if (typeof entry !== "object" || entry === null) return []
    const e = entry as { value?: unknown; options?: unknown }
    if (Array.isArray(e.options)) return optionValues(e.options)
    return typeof e.value === "string" ? [e.value] : []
  })
}

/** Whether an advertised session mode is the agent's plan mode (id or name). */
function isPlanMode(mode: { id: string; name: string }): boolean {
  return mode.id === PLAN_VALUE || /plan/i.test(mode.name)
}

/**
 * Whether a permission request asks to carry out a finished plan: Codex's
 * adapter asks with the plan as `rawInput.plan` (#1337). Its tool approvals
 * carry a command or a file change instead.
 */
function asksToCarryOutPlan(request: RequestPermissionRequest): boolean {
  const raw = request.toolCall.rawInput
  return (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { plan?: unknown }).plan === "string"
  )
}

/**
 * The latest reply of a plan turn, held until something else arrives. Codex's
 * adapter sends the finished plan as a reply of its own just before asking to
 * carry it out; the gate shows the plan, so that reply is dropped rather than
 * shown twice. Codex reports usage and its thread going idle in between, so
 * status updates like those pass straight through and keep the reply held. Any
 * other reply goes out as soon as the next message, reasoning or tool call
 * arrives, or when the turn ends.
 */
class HeldReply {
  private chunks: SessionUpdate[] = []
  private messageId: string | null = null

  /** The updates to send now that `update` arrived. */
  take(update: SessionUpdate): SessionUpdate[] {
    if (STATUS_UPDATES.has(update.sessionUpdate)) return [update]
    if (update.sessionUpdate !== "agent_message_chunk") {
      return [...this.release(), update]
    }
    const messageId = update.messageId ?? null
    const ready = messageId === this.messageId ? [] : this.release()
    this.messageId = messageId
    this.chunks.push(update)
    return ready
  }

  /** Everything held, dropping it when it is the plan the gate shows. */
  withoutPlan(plan: string): SessionUpdate[] {
    const text = this.text()
    const held = this.release()
    return text.trim() === plan.trim() ? [] : held
  }

  /** The held reply's text. */
  text(): string {
    return this.chunks
      .map((u) =>
        u.sessionUpdate === "agent_message_chunk" ? blockText(u.content) : ""
      )
      .join("")
  }

  /** Everything held, in arrival order. */
  release(): SessionUpdate[] {
    const held = this.chunks
    this.chunks = []
    this.messageId = null
    return held
  }
}

/** Updates about the session rather than the conversation, which a held reply lets by. */
const STATUS_UPDATES = new Set<SessionUpdate["sessionUpdate"]>([
  "usage_update",
  "session_info_update",
  "available_commands_update",
  "current_mode_update",
  "config_option_update",
])
