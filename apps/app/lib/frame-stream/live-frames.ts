/**
 * Live frames (spec #1512, ticket #1516): which frames on a hosted canvas are
 * one shared, streamed browser, and who is on each.
 *
 * Frames are each person's own copy by default: a local iframe. Going live is
 * a choice per frame and per person (the frame bar's Go live toggle). Who is
 * live is carried in presence, so a closed tab drops off on its own:
 * - A frame is live while at least one present viewer is on it, or while the
 *   agent has control of it (it drives the one browser in the Sandbox).
 * - Going live pulls nobody else in. Others keep their own copy and see the
 *   frame's Live tag.
 * - Someone who opens the canvas while a frame is live lands on it live
 *   ({@link landOnLiveFrames}). Someone who left stays on their own copy for
 *   the rest of the session, however long the frame stays live.
 * - Live ends when the last person leaves; the stream service pauses the
 *   browser once nobody watches it.
 *
 * This module is the pure rule, React-free, so it's pinned by unit tests
 * (`live-frames.test.ts`). `useSharedFrames` feeds it.
 */

import { AGENT_PARTY } from "@/lib/canvas/frame-control"

/** One present viewer, as far as live frames care: who, and which frames
 *  they're live on. Another tab of this viewer's own account counts too. */
export type LivePresence = {
  id: string
  liveFrameIds?: readonly string[]
}

/** This viewer's choices this session. */
export type LiveChoices = {
  /** Frames this viewer is on: Go live, Join, or landing on open. */
  joined: ReadonlySet<string>
  /** Frames this viewer left on purpose; landing never puts them back. */
  left: ReadonlySet<string>
}

export type LiveFrame = {
  /** Someone is on the frame: it streams from the Sandbox. */
  live: boolean
  /** The parties on it, in a stable order: people by user id, then the agent
   *  ({@link AGENT_PARTY}) while it has control. */
  on: string[]
  /** This viewer is on it, so sees the live stream rather than their copy. */
  viewerOn: boolean
}

export const NOT_LIVE: LiveFrame = { live: false, on: [], viewerOn: false }

/**
 * Per frame that can go live (its Workspace streams frames): whether it's
 * live, who is on it, and whether this viewer is.
 *
 * @param frameIds the frames that can go live; any other frame is never live.
 * @param others other viewers' presences (not this tab's).
 * @param drivers each frame's shared Frame Control driver (the record keyed by
 *   the frame alone), so the agent's control keeps the frame live.
 */
export function liveFrames({
  frameIds,
  viewerId,
  others,
  choices,
  drivers,
}: {
  frameIds: Iterable<string>
  viewerId: string | null
  others: readonly LivePresence[]
  choices: LiveChoices
  drivers: (frameId: string) => string | null | undefined
}): Map<string, LiveFrame> {
  const result = new Map<string, LiveFrame>()
  for (const frameId of frameIds) {
    const viewerOn = choices.joined.has(frameId)
    const people = new Set<string>()
    if (viewerOn && viewerId) people.add(viewerId)
    for (const other of others) {
      if (other.liveFrameIds?.includes(frameId)) people.add(other.id)
    }
    const on = [...people]
    if (drivers(frameId) === AGENT_PARTY) on.push(AGENT_PARTY)
    result.set(frameId, { live: on.length > 0 || viewerOn, on, viewerOn })
  }
  return result
}

/**
 * The frames a viewer who just opened the canvas lands on: those already live
 * that they haven't left this session. Only the frames live when the canvas
 * opens count, so the caller asks this only while the canvas is opening.
 */
export function landOnLiveFrames(
  frames: ReadonlyMap<string, LiveFrame>,
  choices: LiveChoices
): string[] {
  const landed: string[] = []
  for (const [frameId, frame] of frames) {
    if (!frame.live || frame.viewerOn || choices.left.has(frameId)) continue
    landed.push(frameId)
  }
  return landed
}

/** What this viewer's presence says it's live on: the frames it's on that
 *  can still go live, in a stable order. */
export function presenceLiveFrameIds(
  frames: ReadonlyMap<string, LiveFrame>
): string[] {
  return [...frames]
    .filter(([, frame]) => frame.viewerOn)
    .map(([id]) => id)
    .sort()
}
