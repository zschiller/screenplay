/**
 * Live frames (spec #1512, ticket #1516): which frames on a hosted canvas are
 * one shared, streamed browser, and who is on each.
 *
 * Frames are everyone's own copy by default: a local iframe that follows the
 * room's route, shared state and Knobs. Going live works like a route change:
 * it's the frame's, so it happens to everyone on the canvas.
 * - A frame is live while someone has turned it live (the frame bar's Go live
 *   toggle, stored on the frame like its route), or while the agent has
 *   control of it (it drives the one browser in the Sandbox). The agent
 *   picking a frame up also turns it live (#1522, `roomFrameControlStore`),
 *   so it stays live after the agent hands it back.
 * - Everyone on the canvas is on a live frame, and anyone who opens the
 *   canvas lands on it. Turning it off ends it for everyone, back to own
 *   copies. Nobody watching pauses its browser; the stream service does that.
 *
 * This module is the pure rule, React-free, so it's pinned by unit tests
 * (`live-frames.test.ts`). `useSharedFrames` feeds it.
 */

import { AGENT_PARTY } from "@/lib/canvas/frame-control"

export type LiveFrame = {
  /** The frame streams from the Sandbox, for everyone on the canvas. */
  live: boolean
  /** The parties on it, in a stable order: this viewer, the other people
   *  here, then the agent ({@link AGENT_PARTY}) while it has control. */
  on: string[]
  /** This viewer sees the live stream rather than their own copy. */
  viewerOn: boolean
}

export const NOT_LIVE: LiveFrame = { live: false, on: [], viewerOn: false }

/**
 * Per frame that can go live (its Workspace streams frames): whether it's
 * live, who is on it, and whether this viewer is.
 *
 * @param frameIds the frames that can go live; any other frame is never live.
 * @param turnedLive whether someone turned the frame live (the frame's own
 *   flag, synced like its route).
 * @param others the other people on the canvas, by user id.
 * @param drivers each frame's shared Frame Control driver (the record keyed by
 *   the frame alone), so the agent's control keeps the frame live.
 */
export function liveFrames({
  frameIds,
  turnedLive,
  viewerId,
  others,
  drivers,
}: {
  frameIds: Iterable<string>
  turnedLive: (frameId: string) => boolean
  viewerId: string | null
  others: readonly string[]
  drivers: (frameId: string) => string | null | undefined
}): Map<string, LiveFrame> {
  const people = [...new Set([...(viewerId ? [viewerId] : []), ...others])]
  const result = new Map<string, LiveFrame>()
  for (const frameId of frameIds) {
    const agent = drivers(frameId) === AGENT_PARTY
    const live = turnedLive(frameId) || agent
    result.set(
      frameId,
      live
        ? {
            live,
            on: agent ? [...people, AGENT_PARTY] : people,
            viewerOn: true,
          }
        : NOT_LIVE
    )
  }
  return result
}

/**
 * The Workspace a Mockup goes live in (#1523). A Mockup is static HTML with
 * no Workspace of its own to run in, so its live browser borrows one whose
 * frames can go live: the one it went live in while it's live there, else its
 * owning chat's, else the first. Going live records the answer on the Mockup
 * (`liveBranchId`), so everyone, and the agent, find the same browser.
 * Undefined when no Workspace's frames can go live (none is running).
 *
 * @param streaming the Workspaces whose frames can go live.
 */
export function mockupLiveWorkspace({
  live,
  liveBranchId,
  ownerBranchId,
  streaming,
}: {
  live: boolean
  liveBranchId: string | undefined
  ownerBranchId: string | undefined
  streaming: readonly string[]
}): string | undefined {
  if (live && liveBranchId && streaming.includes(liveBranchId))
    return liveBranchId
  if (ownerBranchId && streaming.includes(ownerBranchId)) return ownerBranchId
  return [...streaming].sort()[0]
}
