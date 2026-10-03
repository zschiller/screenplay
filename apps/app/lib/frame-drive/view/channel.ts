import { randomUUID } from "node:crypto"

import {
  isDriveOp,
  type DriveOp,
  type DriveResult,
  type DriveScreenshotResult,
  type FrameDriveBackend,
} from "@/lib/frame-drive/contract"
import type {
  CanvasAnswer,
  FrameSnapshot,
  ServerToCanvas,
} from "@/lib/frame-drive/mac/protocol"
import type { FrameDriveAnswers } from "@/lib/frame-drive/view/answers"
import type { RoomDoc } from "@/lib/room-access"

/**
 * The hosted Frame Drive backend for mockups (#1391): a mockup has no
 * Sandbox, so the agent drives it in the asker's own view. Each op is an ask
 * in the Room's doc that only the asker's canvas runs (`asks.ts`), through
 * the same relay and Sandbox Bridge as on the Mac; the turn waits for the
 * answer the canvas posts. The screenshot is the page as it is in their view,
 * rendered away from the canvas, since no browser can photograph theirs.
 *
 * Frames on hosted are one shared browser in their Workspace's Sandbox, whose
 * backend is #1396, so this one says it can't drive them yet.
 */

/** How long a gesture may take in the page before the turn gives up. */
const OP_TIMEOUT_MS = 15_000
/** How long a read of the page for a screenshot may take. */
const SNAPSHOT_TIMEOUT_MS = 8_000
/** How long bringing a Mockup into the asker's view may take. */
const REVEAL_TIMEOUT_MS = 5_000
/** How often the turn looks for the answer. */
const POLL_MS = 150

const NO_ANSWER =
  "The canvas didn't answer. The agent drives a Mockup in the canvas of the person who asked, so it has to be open in their browser."
const FRAME_NOT_HERE =
  "The agent can't drive a frame in the browser yet, only Mockups. In the Screenplay desktop app it drives frames too."

/** Renders a page snapshot to an image, as the person would see it. */
export type RenderSnapshot = (
  snapshot: FrameSnapshot
) => Promise<{ data: Buffer; mediaType: string }>

export function viewFrameDriveBackend(
  room: RoomDoc,
  viewerId: string,
  deps: {
    answers: FrameDriveAnswers
    render: RenderSnapshot
    opTimeoutMs?: number
    snapshotTimeoutMs?: number
    pollMs?: number
    now?: () => number
    sleep?: (ms: number) => Promise<void>
  }
): FrameDriveBackend {
  const opTimeoutMs = deps.opTimeoutMs ?? OP_TIMEOUT_MS
  const snapshotTimeoutMs = deps.snapshotTimeoutMs ?? SNAPSHOT_TIMEOUT_MS
  const pollMs = deps.pollMs ?? POLL_MS
  const now = deps.now ?? Date.now
  const sleep =
    deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)))

  /** Why `frameId` can't be driven here, or null for a mockup. */
  const notDrivable = (frameId: string) =>
    room.readDoc((c) => {
      if (c.mockupLayers.get(frameId)) return null
      if (c.iframeLayers.get(frameId)) return FRAME_NOT_HERE
      return `There's no Mockup ${frameId} on the canvas.`
    })

  /** Ask the asker's canvas, and wait for its answer or the timeout. */
  async function ask(
    message: ServerToCanvas,
    timeoutMs: number
  ): Promise<CanvasAnswer | null> {
    await deps.answers.expect(message.id, {
      roomId: room.roomId,
      viewer: viewerId,
    })
    await room.mutateDoc((c) =>
      c.frameDriveAsks.set(message.id, { viewer: viewerId, message, at: now() })
    )
    let answer: CanvasAnswer | null = null
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
    return answer
  }

  return {
    async unavailable(frameId) {
      if (frameId === undefined) return null
      return notDrivable(frameId)
    },

    async run(frameId, op: DriveOp): Promise<DriveResult> {
      // Only the contract's ops ever leave the server.
      if (!isDriveOp(op)) {
        return { status: "failed", reason: "unknown drive op" }
      }
      const reason = await notDrivable(frameId)
      if (reason) return { status: "unavailable", reason }
      const answer = await ask(
        { type: "op", id: randomUUID(), frameId, op },
        opTimeoutMs
      )
      if (!answer) return { status: "unavailable", reason: NO_ANSWER }
      return answer.type === "result"
        ? answer.result
        : { status: "failed", reason: "unexpected answer" }
    },

    async reveal(frameId) {
      const reason = await notDrivable(frameId)
      if (reason) return reason
      const answer = await ask(
        { type: "reveal", id: randomUUID(), frameId },
        REVEAL_TIMEOUT_MS
      )
      if (!answer) return NO_ANSWER
      return answer.type === "revealed" && answer.ok
        ? null
        : "The Mockup isn't on the open canvas."
    },

    async screenshot(frameId): Promise<DriveScreenshotResult> {
      const reason = await notDrivable(frameId)
      if (reason) return { status: "unavailable", reason }
      const answer = await ask(
        { type: "snapshot", id: randomUUID(), frameId },
        snapshotTimeoutMs
      )
      if (!answer) return { status: "unavailable", reason: NO_ANSWER }
      if (answer.type !== "snapshot" || !answer.snapshot) {
        return {
          status: "unavailable",
          reason:
            "The Mockup isn't loaded on the canvas, or its page didn't answer.",
        }
      }
      try {
        const image = await deps.render(answer.snapshot)
        return {
          status: "shot",
          shot: {
            ...image,
            note: "Rendered from the page as it is in the person's view; anything its scripts draw into a canvas element doesn't show.",
          },
        }
      } catch (err) {
        return {
          status: "unavailable",
          reason: `Couldn't render the page: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    },
  }
}
