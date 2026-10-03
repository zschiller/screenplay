import "server-only"

import sharp from "sharp"

import { EMPTY_FRAME_CONTROL } from "@/lib/canvas/frame-control"
import type { FrameControlStore } from "@/lib/frame-drive/agent-driver"
import type { RoomDoc } from "@/lib/room-access"

/** Longest side of a screenshot, as `view_frame`'s. */
const MAX_SHOT_DIM = 1280

/** Frame Control's records in the Room's doc, for the agent's driver. */
export function roomFrameControlStore(room: RoomDoc): FrameControlStore {
  return {
    update: (key, fn) =>
      room.mutateDoc((c) => {
        const current = c.frameControl.get(key)
        const next = fn(current ?? EMPTY_FRAME_CONTROL)
        if (next === current) return next
        // A record nobody drives or waits on says nothing; don't keep it.
        if (next.driver === null && next.requests.length === 0) {
          if (current) c.frameControl.delete(key)
        } else {
          c.frameControl.set(key, next)
        }
        return next
      }),
  }
}

/** Shrink and encode a screenshot for the model. */
export async function encodeShot(
  png: Buffer,
  size: { width: number; height: number }
): Promise<{ data: Buffer; mediaType: string }> {
  const scale = Math.min(1, MAX_SHOT_DIM / Math.max(size.width, size.height))
  const data = await sharp(png)
    .resize(
      Math.max(1, Math.round(size.width * scale)),
      Math.max(1, Math.round(size.height * scale)),
      { fit: "fill" }
    )
    .webp({ quality: 85 })
    .toBuffer()
  return { data, mediaType: "image/webp" }
}
