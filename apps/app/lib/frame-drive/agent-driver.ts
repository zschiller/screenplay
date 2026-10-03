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
      return {
        status: "wait",
        driver: made.driver,
        takenOver: made.takenOver,
      }
    }

    this.held.add(key)
    const result = await this.deps.backend.run(frameId, op)
    if (result.status === "taken") {
      // Taken over between the gate and the gesture: the canvas refused it.
      this.held.delete(key)
      return { status: "wait", driver: null, takenOver: true }
    }
    return result
  }

  screenshot(frameId: string): Promise<DriveScreenshotResult> {
    return this.deps.backend.screenshot(frameId)
  }

  /** Stop driving the frame and leave the queue for it. */
  /** Why no frame on the canvas can be driven right now, or null. */
  canvasUnavailable(): Promise<string | null> {
    return this.deps.backend.unavailable()
  }

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
