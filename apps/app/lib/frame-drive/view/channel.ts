import type {
  DriveResult,
  DriveScreenshotResult,
  FrameDriveBackend,
} from "@/lib/frame-drive/contract"
import {
  askerCanvas,
  type AskerCanvas,
  type CanvasTransport,
} from "@/lib/frame-drive/canvas/channel"
import type { PageInView } from "@/lib/frame-drive/canvas/protocol"
import type { FrameDriveAnswers } from "@/lib/frame-drive/view/answers"
import type { RoomDoc } from "@/lib/room-access"

/**
 * The asker's-canvas channel on hosted (#1391, `canvas/channel.ts`), and the
 * Frame Drive backend for mockups over it. A mockup has no Sandbox, so the
 * agent drives it in the asker's own view. Each message is an ask in the
 * Room's doc that only the asker's canvas runs (`asks.ts`), through the same
 * relay and Sandbox Bridge as on the Mac; the turn waits for the answer the
 * canvas posts. The screenshot is the page as it is in their view, rendered
 * away from the canvas, since no browser can photograph theirs.
 *
 * Frames on hosted are one shared browser in their Workspace's Sandbox, with
 * a backend of their own (#1396), so this one doesn't drive them. The
 * channel does bring a shared frame into the asker's view (#1390), which
 * only their canvas can.
 */

/** How often the turn looks for the answer. */
const POLL_MS = 150

const NO_ANSWER =
  "The canvas didn’t answer. The agent drives a Mockup in the canvas of the person who asked, so it has to be open in their browser."
const FRAME_NOT_HERE =
  "The agent can’t drive a frame in the browser yet, only Mockups. In the Screenplay desktop app it drives frames too."

/** Renders a page snapshot to an image, as the person would see it. */
export type RenderSnapshot = (
  snapshot: PageInView
) => Promise<{ data: Buffer; mediaType: string }>

export type ViewChannelDeps = {
  answers: FrameDriveAnswers
  opTimeoutMs?: number
  snapshotTimeoutMs?: number
  pollMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

/**
 * The hosted transport to `viewerId`'s canvas: an ask in the Room's doc
 * addressed to them, and the answer their canvas posts, polled for.
 */
export function viewCanvasTransport(
  room: RoomDoc,
  viewerId: string,
  deps: ViewChannelDeps
): CanvasTransport {
  const pollMs = deps.pollMs ?? POLL_MS
  const now = deps.now ?? Date.now
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))
  return {
    async ask(message, timeoutMs) {
      await deps.answers.expect(message.id, {
        roomId: room.roomId,
        viewer: viewerId,
      })
      await room.mutateDoc((c) =>
        c.frameDriveAsks.set(message.id, {
          viewer: viewerId,
          message,
          at: now(),
        })
      )
      let answer = null
      try {
        const deadline = now() + timeoutMs
        while (!answer && now() < deadline) {
          await sleep(pollMs)
          answer = await deps.answers.take(message.id)
        }
      } finally {
        await deps.answers.forget(message.id).catch(() => {})
        // The canvas clears an ask it answers; one nobody answered goes here.
        if (!answer) {
          await room
            .mutateDoc((c) => {
              if (c.frameDriveAsks.has(message.id))
                c.frameDriveAsks.delete(message.id)
            })
            .catch(() => {})
        }
      }
      return answer ?? NO_ANSWER
    },
  }
}

/** Why `frameId` can't be driven here, or null for a mockup. */
function notDrivable(room: RoomDoc, frameId: string) {
  return room.readDoc((c) => {
    if (c.mockupLayers.get(frameId)) return null
    if (c.iframeLayers.get(frameId)) return FRAME_NOT_HERE
    return `There’s no Mockup ${frameId} on the canvas.`
  })
}

/**
 * `viewerId`'s canvas on hosted. It brings a Mockup or a shared frame into
 * their view, and says so when there's neither.
 */
export function viewAskerCanvas(
  room: RoomDoc,
  viewerId: string,
  deps: ViewChannelDeps
): AskerCanvas {
  const canvas = askerCanvas(viewCanvasTransport(room, viewerId, deps), {
    opTimeoutMs: deps.opTimeoutMs,
    readTimeoutMs: deps.snapshotTimeoutMs,
  })
  return {
    ...canvas,
    async reveal(frameId) {
      const frame = await room.readDoc((c) => c.iframeLayers.has(frameId))
      const reason = frame ? null : await notDrivable(room, frameId)
      return reason ?? canvas.reveal(frameId)
    },
  }
}

/** The hosted Frame Drive backend for mockups, over the asker's canvas. */
export function viewFrameDriveBackend(
  room: RoomDoc,
  canvas: AskerCanvas,
  deps: { render: RenderSnapshot }
): FrameDriveBackend {
  return {
    async unavailable(frameId) {
      if (frameId === undefined) return null
      return notDrivable(room, frameId)
    },

    async run(frameId, op): Promise<DriveResult> {
      const reason = await notDrivable(room, frameId)
      if (reason) return { status: "unavailable", reason }
      return canvas.run(frameId, op)
    },

    async screenshot(frameId): Promise<DriveScreenshotResult> {
      const reason = await notDrivable(room, frameId)
      if (reason) return { status: "unavailable", reason }
      const snapshot = await canvas.snapshot(frameId)
      if (typeof snapshot === "string") {
        return { status: "unavailable", reason: snapshot }
      }
      try {
        const image = await deps.render(snapshot)
        return {
          status: "shot",
          shot: {
            ...image,
            note: "Rendered from the page as it is in the person’s view; anything its scripts draw into a canvas element doesn’t show.",
          },
        }
      } catch (err) {
        return {
          status: "unavailable",
          reason: `Couldn’t render the page: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    },
  }
}
