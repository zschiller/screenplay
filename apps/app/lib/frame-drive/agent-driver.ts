import {
  AGENT_PARTY,
  EMPTY_FRAME_CONTROL,
  reduceFrameControl,
  type FrameControlPresence,
  type FrameControlRecord,
} from "@/lib/canvas/frame-control"
import {
  isGesture,
  type DriveOp,
  type DrivePace,
  type DriveResult,
  type DriveScreenshotResult,
  type FrameDriveBackend,
} from "@/lib/frame-drive/contract"

/**
 * How the agent asks Frame Control (#1387) for a frame before a gesture.
 *
 * - The agent drives already: go.
 * - Nobody drives: it picks the frame up.
 * - A person drives: it waits. Its request queues (it "asks again through the
 *   gate"), so it carries on when they leave Interact.
 * - It drove the frame and lost it since its last gesture (the person took
 *   over): this gesture fails whoever drives now, so it stops and asks in chat
 *   rather than fighting for the frame.
 *
 * Pure, so every rule is pinned by fixture tests (`agent-driver.test.ts`).
 */
export type AgentDriveDecision =
  | { kind: "drive"; record: FrameControlRecord }
  | {
      kind: "wait"
      record: FrameControlRecord
      /** Who drives instead, or null when nobody does. */
      driver: string | null
      /** The agent drove this frame and was taken over since. */
      takenOver: boolean
    }

export function agentAsksToDrive(
  record: FrameControlRecord,
  opts: { at: number; heldBefore: boolean }
): AgentDriveDecision {
  if (record.driver === AGENT_PARTY) return { kind: "drive", record }
  if (opts.heldBefore) {
    // Taken over since the last gesture: fail this one, and queue behind the
    // person (if one still drives) so control comes back when they let go.
    const next =
      record.driver === null
        ? record
        : reduceFrameControl(record, {
            type: "request",
            by: AGENT_PARTY,
            at: opts.at,
          })
    return {
      kind: "wait",
      record: next,
      driver: record.driver,
      takenOver: true,
    }
  }
  const next = reduceFrameControl(record, {
    type: "request",
    by: AGENT_PARTY,
    at: opts.at,
  })
  if (next.driver === AGENT_PARTY) return { kind: "drive", record: next }
  return { kind: "wait", record: next, driver: next.driver, takenOver: false }
}

/**
 * The person asked the agent in chat to show them something or get a frame
 * into a state (#1390). The ask is the grant, so there's no second prompt:
 *
 * - Nobody drives, or the asker does: the agent drives (`chat-ask`).
 * - Someone else drives (a shared frame): its ask queues behind them.
 * - The asker took the frame from the agent and still has it: it waits and
 *   queues. A chat ask never undoes a take-over; the agent gets the frame
 *   back when they leave Interact.
 *
 * `takenBy` is who took the frame from the agent and hasn't let go, as the
 * driver remembers it; `heldBefore` catches a take-over since its last op.
 */
export function agentAsksInChat(
  record: FrameControlRecord,
  opts: {
    asker: string
    at: number
    heldBefore: boolean
    takenBy: string | null
  }
): AgentDriveDecision {
  if (record.driver === AGENT_PARTY) return { kind: "drive", record }
  const takenBy =
    opts.heldBefore && record.driver !== null ? record.driver : opts.takenBy
  if (takenBy !== null && record.driver === takenBy) {
    return {
      kind: "wait",
      record: reduceFrameControl(record, {
        type: "request",
        by: AGENT_PARTY,
        at: opts.at,
      }),
      driver: record.driver,
      takenOver: true,
    }
  }
  const next = reduceFrameControl(record, {
    type: "chat-ask",
    asker: opts.asker,
    at: opts.at,
  })
  if (next.driver === AGENT_PARTY) return { kind: "drive", record: next }
  return { kind: "wait", record: next, driver: next.driver, takenOver: false }
}

/**
 * The agent lets go of a frame: stops driving it and withdraws any request,
 * so a person who leaves Interact later doesn't hand it to an agent that has
 * moved on.
 */
export function agentLetsGo(
  record: FrameControlRecord,
  presence: FrameControlPresence
): FrameControlRecord {
  const released = reduceFrameControl(record, {
    type: "release",
    by: AGENT_PARTY,
    presence,
  })
  return reduceFrameControl(released, { type: "cancel", by: AGENT_PARTY })
}

/**
 * Where the Frame Control records live: the Room's `frameControl` collection.
 * `update` applies `fn` to one record in a single transaction and returns the
 * record it stored (a record nobody drives or waits on is deleted).
 */
export interface FrameControlStore {
  update(
    key: string,
    fn: (record: FrameControlRecord) => FrameControlRecord
  ): Promise<FrameControlRecord>
}

/**
 * How long the agent keeps a frame, or its place in the queue, after its last
 * op. An agent whose turn ended without letting go would otherwise leave the
 * frame saying "Agent is driving" (or take it back when the person leaves
 * Interact) long after it moved on.
 */
export const AGENT_IDLE_RELEASE_MS = 60_000

export type AgentDriveOutcome =
  | DriveResult
  | {
      status: "wait"
      /** Who drives instead, or null when nobody does. */
      driver: string | null
      takenOver: boolean
    }

/** What starting to drive from a chat ask came to. */
export type AgentStartOutcome =
  | { status: "driving" }
  | { status: "wait"; driver: string | null; takenOver: boolean }
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string }

export interface AgentFrameDriverDeps {
  backend: FrameDriveBackend
  store: FrameControlStore
  /** The Frame Control key of the frame copy the agent drives in. */
  keyOf(frameId: string): string
  /** Who is online, for handing control on when the agent lets go. */
  presence(): FrameControlPresence
  now?: () => number
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/**
 * The agent's side of Frame Drive: every op goes through here, so every
 * gesture asks Frame Control first and the agent always yields. One per
 * process and runtime, because it remembers which frames the agent holds
 * between tool calls (that's how it tells "taken over" from "never had it").
 */
export class AgentFrameDriver {
  private readonly held = new Set<string>()
  private readonly idle = new Map<string, unknown>()
  /** The pace a chat ask set for each frame, until the agent lets go. */
  private readonly pace = new Map<string, DrivePace>()
  /** Who took each frame from the agent and may still have it. */
  private readonly takenBy = new Map<string, string>()
  private readonly now: () => number
  private readonly setTimer: (fn: () => void, ms: number) => unknown
  private readonly clearTimer: (timer: unknown) => void

  constructor(private readonly deps: AgentFrameDriverDeps) {
    this.now = deps.now ?? Date.now
    // Unref'd, so a pending idle release never holds the process open.
    this.setTimer =
      deps.setTimer ??
      ((fn, ms) => {
        const timer = setTimeout(fn, ms)
        timer.unref?.()
        return timer
      })
    this.clearTimer =
      deps.clearTimer ??
      ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  }

  async run(frameId: string, op: DriveOp): Promise<AgentDriveOutcome> {
    const unavailable = await this.deps.backend.unavailable(frameId)
    if (unavailable) return { status: "unavailable", reason: unavailable }
    if (!isGesture(op)) return this.deps.backend.run(frameId, op)

    const key = this.deps.keyOf(frameId)
    let decision: AgentDriveDecision | null = null
    await this.deps.store.update(key, (record) => {
      decision = agentAsksToDrive(record, {
        at: this.now(),
        heldBefore: this.held.has(key),
      })
      return decision.record
    })
    const made = decision as AgentDriveDecision | null
    if (!made)
      return { status: "failed", reason: "Frame Control didn't answer" }
    this.touch(key)
    if (made.kind === "wait") {
      this.held.delete(key)
      if (made.takenOver && made.driver) this.takenBy.set(key, made.driver)
      return {
        status: "wait",
        driver: made.driver,
        takenOver: made.takenOver,
      }
    }

    this.held.add(key)
    const pace = this.pace.get(key)
    const result = await this.deps.backend.run(
      frameId,
      pace && !op.pace ? { ...op, pace } : op
    )
    if (result.status === "taken") {
      // Taken over between the gate and the gesture (or mid-glide): the
      // canvas refused it. Remember who took it, so a chat ask doesn't take
      // it back while they still drive.
      this.held.delete(key)
      const now = await this.deps.store.update(key, (record) => record)
      const driver =
        now.driver !== null && now.driver !== AGENT_PARTY ? now.driver : null
      if (driver) this.takenBy.set(key, driver)
      return { status: "wait", driver, takenOver: true }
    }
    return result
  }

  /**
   * Start driving a frame because `asker` asked for it in chat (#1390): the
   * ask grants control ({@link agentAsksInChat}), and `pace` sets how every
   * gesture plays until the agent lets go. For `show`, the frame is brought
   * into the asker's view; `jump` moves nobody's view.
   */
  async start(
    frameId: string,
    opts: { asker: string; pace: DrivePace }
  ): Promise<AgentStartOutcome> {
    const unavailable = await this.deps.backend.unavailable(frameId)
    if (unavailable) return { status: "unavailable", reason: unavailable }
    const key = this.deps.keyOf(frameId)
    let decision: AgentDriveDecision | null = null
    await this.deps.store.update(key, (record) => {
      decision = agentAsksInChat(record, {
        asker: opts.asker,
        at: this.now(),
        heldBefore: this.held.has(key),
        takenBy: this.takenBy.get(key) ?? null,
      })
      return decision.record
    })
    const made = decision as AgentDriveDecision | null
    if (!made)
      return { status: "failed", reason: "Frame Control didn't answer" }
    this.touch(key)
    this.pace.set(key, opts.pace)
    if (made.kind === "wait") {
      this.held.delete(key)
      if (made.takenOver && made.driver) this.takenBy.set(key, made.driver)
      return {
        status: "wait",
        driver: made.driver,
        takenOver: made.takenOver,
      }
    }
    this.held.add(key)
    this.takenBy.delete(key)
    if (opts.pace === "show") {
      // Best effort: the demo still runs if the canvas can't move.
      await this.deps.backend.reveal(frameId).catch(() => null)
    }
    return { status: "driving" }
  }

  screenshot(frameId: string): Promise<DriveScreenshotResult> {
    return this.deps.backend.screenshot(frameId)
  }

  /** Why no frame on the canvas can be driven right now, or null. */
  canvasUnavailable(): Promise<string | null> {
    return this.deps.backend.unavailable()
  }

  /** Whether the canvas has `frameId` loaded: null when it has. */
  frameUnavailable(frameId: string): Promise<string | null> {
    return this.deps.backend.unavailable(frameId)
  }

  /** Bring a frame into the asker's view. Null when it did, else why not. */
  reveal(frameId: string): Promise<string | null> {
    return this.deps.backend.reveal(frameId)
  }

  /** Stop driving the frame and leave the queue for it. */
  async letGo(frameId: string): Promise<void> {
    const key = this.deps.keyOf(frameId)
    this.release(key)
    await this.deps.store.update(key, (record) =>
      agentLetsGo(record, this.deps.presence())
    )
  }

  private touch(key: string): void {
    const pending = this.idle.get(key)
    if (pending !== undefined) this.clearTimer(pending)
    this.idle.set(
      key,
      this.setTimer(() => {
        this.idle.delete(key)
        this.held.delete(key)
        this.pace.delete(key)
        void this.deps.store
          .update(key, (record) => agentLetsGo(record, this.deps.presence()))
          .catch(() => {})
      }, AGENT_IDLE_RELEASE_MS)
    )
  }

  private release(key: string): void {
    const pending = this.idle.get(key)
    if (pending !== undefined) this.clearTimer(pending)
    this.idle.delete(key)
    this.held.delete(key)
    this.pace.delete(key)
    this.takenBy.delete(key)
  }
}

/** A store over an in-memory map, for tests and fixtures. */
export function memoryFrameControlStore(
  records = new Map<string, FrameControlRecord>()
): FrameControlStore & { records: Map<string, FrameControlRecord> } {
  return {
    records,
    async update(key, fn) {
      const next = fn(records.get(key) ?? EMPTY_FRAME_CONTROL)
      if (next.driver === null && next.requests.length === 0)
        records.delete(key)
      else records.set(key, next)
      return next
    },
  }
}
