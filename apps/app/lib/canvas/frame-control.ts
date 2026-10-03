/**
 * Frame Control — who drives a frame (spec #1386, ticket #1387).
 *
 * One party drives a frame at a time: a person, or the agent. Only the
 * driver's input reaches the page. This module is the pure reducer over the
 * record that says who that is, plus the read of it the canvas draws from. It
 * is React-free and side-effect-free, so every handoff rule is pinned by
 * fixture tests (`frame-control.test.ts`).
 *
 * The rules (decided in #981, #1370 and the #1376 exploration):
 * - Anyone picks up a frame nobody drives.
 * - Between people, the driver lets you drive: a request waits for the
 *   driver's Give control (`grant`) or Not now (`decline`). Requests made at
 *   the same moment queue, and the driver picks one.
 * - A driver who leaves keeps control for {@link FRAME_CONTROL_GRACE_MS}, so a
 *   reload is harmless. After that, control passes to the oldest online
 *   requester, or to nobody. Requests from people who left are dropped.
 * - The agent asks through the same gate and always yields: anyone takes
 *   control from it at once. It then waits and asks again (a new `request`,
 *   which queues behind the person who took over).
 * - Asking the agent in chat to show you something (`chat-ask`) grants it
 *   control when the asker drives or nobody does; otherwise its ask queues.
 *
 * The record lives in the Room's Yjs doc (`frameControl`), keyed by the copy
 * of the frame it governs ({@link frameControlKey}); awareness says who is
 * online. The agent runs on the server and is always online.
 */

/** The agent's party id. People are their user ids. */
export const AGENT_PARTY = "@agent"

/** How long a driver who left keeps control, so a reload is harmless. */
export const FRAME_CONTROL_GRACE_MS = 5000

export type FrameControlRequest = {
  /** The party asking to drive. */
  by: string
  /** When they asked (ms); the oldest online request is served first. */
  at: number
}

export type FrameControlRecord = {
  /**
   * Whether this record governs a frame's one shared live copy (hosted shared
   * frames, #1392). A viewer's own copy (today's iframes, the Mac, mockups) is
   * not live: its only parties are that viewer and the agent.
   */
  live: boolean
  /** Who drives: a user id, {@link AGENT_PARTY}, or nobody. */
  driver: string | null
  /** Waiting requests, in the order they were made. */
  requests: FrameControlRequest[]
}

export const EMPTY_FRAME_CONTROL: FrameControlRecord = {
  live: false,
  driver: null,
  requests: [],
}

/**
 * Who is around, from awareness. A person is online while their client is
 * connected; `goneAt` is when a person was last seen leaving. Someone offline
 * with no `goneAt` (they left before this client joined) counts as gone for
 * good. The agent is always online.
 */
export type FrameControlPresence = {
  online: ReadonlySet<string>
  goneAt: ReadonlyMap<string, number>
}

export type FrameControlAction =
  /** Ask to drive: picks up an undriven frame, takes it from the agent (if a
   *  person asks), and otherwise queues. What the driver button does. */
  | { type: "request"; by: string; at: number }
  /** The driver lets a waiting party drive (Give control). */
  | { type: "grant"; by: string; to: string }
  /** The driver turns a request down (Not now). */
  | { type: "decline"; by: string; to: string }
  /** A party withdraws their own request. */
  | { type: "cancel"; by: string }
  /** The driver stops driving; the oldest online requester takes over. */
  | { type: "release"; by: string; presence: FrameControlPresence }
  /** Someone asked the agent in chat to show them something. */
  | { type: "chat-ask"; asker: string; at: number }
  /** Time passed or someone left: apply the grace period and drop requests
   *  from people who are gone. */
  | { type: "settle"; now: number; presence: FrameControlPresence }

export function isOnline(
  presence: FrameControlPresence,
  party: string
): boolean {
  return party === AGENT_PARTY || presence.online.has(party)
}

/** Gone past the grace period: offline, and left at least that long ago. */
function goneForGood(
  presence: FrameControlPresence,
  party: string,
  now: number
): boolean {
  if (isOnline(presence, party)) return false
  const goneAt = presence.goneAt.get(party)
  return goneAt === undefined || now - goneAt >= FRAME_CONTROL_GRACE_MS
}

/** The oldest request from someone online, or null. */
export function oldestOnlineRequester(
  record: FrameControlRecord,
  presence: FrameControlPresence
): string | null {
  let next: FrameControlRequest | null = null
  for (const r of record.requests) {
    if (!isOnline(presence, r.by)) continue
    if (!next || r.at < next.at) next = r
  }
  return next?.by ?? null
}

/** The one place the driver changes: the new driver's own request is spent. */
function withDriver(
  record: FrameControlRecord,
  driver: string | null
): FrameControlRecord {
  return {
    ...record,
    driver,
    requests: record.requests.filter((r) => r.by !== driver),
  }
}

function withRequest(
  record: FrameControlRecord,
  by: string,
  at: number
): FrameControlRecord {
  if (record.requests.some((r) => r.by === by)) return record
  return { ...record, requests: [...record.requests, { by, at }] }
}

/**
 * Apply one action. Returns the same record when nothing changes, so callers
 * can skip the write.
 */
export function reduceFrameControl(
  record: FrameControlRecord,
  action: FrameControlAction
): FrameControlRecord {
  switch (action.type) {
    case "request": {
      const { by, at } = action
      if (record.driver === by) return record
      if (record.driver === null) return withDriver(record, by)
      // The agent always yields: a person takes control from it at once.
      if (record.driver === AGENT_PARTY && by !== AGENT_PARTY)
        return withDriver(record, by)
      return withRequest(record, by, at)
    }
    case "grant": {
      if (record.driver !== action.by) return record
      if (!record.requests.some((r) => r.by === action.to)) return record
      return withDriver(record, action.to)
    }
    case "decline": {
      if (record.driver !== action.by) return record
      return dropRequests(record, (r) => r.by === action.to)
    }
    case "cancel":
      return dropRequests(record, (r) => r.by === action.by)
    case "release": {
      if (record.driver !== action.by) return record
      return withDriver(record, oldestOnlineRequester(record, action.presence))
    }
    case "chat-ask": {
      const { asker, at } = action
      if (record.driver === AGENT_PARTY) return record
      if (record.driver === null || record.driver === asker)
        return withDriver(record, AGENT_PARTY)
      return withRequest(record, AGENT_PARTY, at)
    }
    case "settle": {
      const { now, presence } = action
      let next = record
      // Requests from people who left are dropped first, so a gone driver's
      // control never passes to someone who is gone too.
      next = dropRequests(next, (r) => goneForGood(presence, r.by, now))
      if (next.driver !== null && goneForGood(presence, next.driver, now)) {
        next = withDriver(next, oldestOnlineRequester(next, presence))
      }
      return next
    }
  }
}

function dropRequests(
  record: FrameControlRecord,
  drop: (r: FrameControlRequest) => boolean
): FrameControlRecord {
  const requests = record.requests.filter((r) => !drop(r))
  if (requests.length === record.requests.length) return record
  return { ...record, requests }
}

/**
 * When the next `settle` can change something: the earliest moment a gone
 * driver or requester runs out of grace. Null when nothing is waiting on the
 * clock. The canvas sets a timer for it.
 */
export function nextSettleAt(
  record: FrameControlRecord,
  presence: FrameControlPresence
): number | null {
  let at: number | null = null
  for (const party of [
    ...(record.driver ? [record.driver] : []),
    ...record.requests.map((r) => r.by),
  ]) {
    if (isOnline(presence, party)) continue
    const goneAt = presence.goneAt.get(party)
    if (goneAt === undefined) return 0
    const due = goneAt + FRAME_CONTROL_GRACE_MS
    if (at === null || due < at) at = due
  }
  return at
}

/**
 * Which record governs what `viewerId` sees of a frame. A viewer's own copy
 * (the desktop app, a Workspace without shared frames) has its own record
 * whose parties are that viewer and the agent: the agent drives a frame in the
 * asker's view, and nobody else's. A shared frame (#1392) is one browser
 * everyone watches, so it has one record, keyed by the layer alone.
 */
export function frameControlKey(
  layerId: string,
  viewerId: string,
  shared = false
): string {
  return shared ? layerId : `${layerId}:${viewerId}`
}

/**
 * The driver as one viewer sees it, for the driver button, the title-line
 * tag, the driver ring and the resize handles.
 * - `none`: nobody drives; the button is today's Interact toggle.
 * - `you`: this viewer drives (Interact pressed).
 * - `agent` / `person`: someone else drives; the frame wears their mark, tag
 *   and ring, can't be resized, and the button takes over (agent) or asks
 *   (person).
 */
export type FrameDriver =
  | { kind: "none" }
  | { kind: "you" }
  | { kind: "agent" }
  | { kind: "person"; id: string }

export function frameDriverFor(
  record: FrameControlRecord | undefined,
  viewerId: string | null
): FrameDriver {
  const driver = record?.driver ?? null
  if (driver === null) return { kind: "none" }
  if (driver === viewerId) return { kind: "you" }
  if (driver === AGENT_PARTY) return { kind: "agent" }
  return { kind: "person", id: driver }
}

/** Someone other than the viewer drives the frame. */
export function drivenByOther(driver: FrameDriver): boolean {
  return driver.kind === "agent" || driver.kind === "person"
}
