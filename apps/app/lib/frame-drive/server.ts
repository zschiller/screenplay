import "server-only"

import sharp from "sharp"

import { AGENT_PARTY, EMPTY_FRAME_CONTROL } from "@/lib/canvas/frame-control"
import type { FrameControlStore } from "@/lib/frame-drive/agent-driver"
import type { RoomDoc } from "@/lib/room-access"

/** Longest side of a screenshot, as `view_frame`'s. */
const MAX_SHOT_DIM = 1280

/**
 * Frame Control's records in the Room's doc, for the agent's driver. `live`
 * is what a new record says: a hosted shared frame's (#1396) governs its one
 * live browser, as the canvas writes it.
 *
 * On a hosted shared frame (keyed by the frame alone), the agent picking the
 * frame up also turns it live, as if it pressed Go live (#1522). The frame
 * then stays live after the agent hands it back or someone takes over, so
 * nobody drops to their own copy and loses the page the agent got into.
 */
export function roomFrameControlStore(
  room: RoomDoc,
  { live = false }: { live?: boolean } = {}
): FrameControlStore {
  return {
    update: (key, fn) =>
      room.mutateDoc((c) => {
        const current = c.frameControl.get(key)
        const next = fn(current ?? { ...EMPTY_FRAME_CONTROL, live })
        if (next === current) return next
        if (
          live &&
          current?.driver !== AGENT_PARTY &&
          next.driver === AGENT_PARTY &&
          c.iframeLayers.get(key)?.live !== true
        ) {
          c.iframeLayers.update(key, { live: true })
        }
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
