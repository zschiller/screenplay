import "server-only"

import { frameControlKey } from "@/lib/canvas/frame-control"
import { kv } from "@/lib/kv"
import { AgentFrameDriver } from "@/lib/frame-drive/agent-driver"
import { encodeShot, roomFrameControlStore } from "@/lib/frame-drive/server"
import { kvFrameDriveAnswers } from "@/lib/frame-drive/view/answers"
import type { AskerCanvas } from "@/lib/frame-drive/canvas/channel"
import {
  viewAskerCanvas,
  viewFrameDriveBackend,
  type RenderSnapshot,
} from "@/lib/frame-drive/view/channel"
import { snapshotDocument } from "@/lib/frame-drive/view/render"
import type { RoomDoc } from "@/lib/room-access"
import { thumbnailCapturer } from "@/lib/thumbnail/capturer"

/** The answers the asker's canvas posts, shared by every function. */
export const frameDriveAnswers = kvFrameDriveAnswers(kv)

/** A page Chromium navigates to as a data URL stays under its 2MB cap. */
const MAX_DOCUMENT_BYTES = 1_900_000

// One driver per Room and asker for the process, as on the Mac: it remembers
// which mockups the agent holds between tool calls.
const DRIVERS_KEY = Symbol.for("screenplay.viewAgentFrameDrivers")
type DriversHost = typeof globalThis & {
  [DRIVERS_KEY]?: Map<string, AgentFrameDriver>
}

/** The asker's own canvas on hosted: where their Mockups run, and the only
 *  thing that can bring a frame into their view. */
export function viewCanvasOf(room: RoomDoc, userId: string): AskerCanvas {
  return viewAskerCanvas(room, userId, { answers: frameDriveAnswers })
}

/**
 * The agent's driver for one asker on hosted (#1391): it drives mockups in
 * the asker's own view, through Frame Control's record for their copy.
 */
export function viewAgentDriver(
  room: RoomDoc,
  userId: string
): AgentFrameDriver {
  const host = globalThis as DriversHost
  const drivers = (host[DRIVERS_KEY] ??= new Map())
  const key = `${room.roomId}:${userId}`
  let driver = drivers.get(key)
  if (!driver) {
    const canvas = viewCanvasOf(room, userId)
    driver = new AgentFrameDriver({
      backend: viewFrameDriveBackend(room, canvas, { render: renderSnapshot }),
      store: roomFrameControlStore(room),
      keyOf: (frameId) => frameControlKey(frameId, userId),
      // A mockup copy's only parties are its viewer and the agent.
      presence: () => ({ online: new Set([userId]), goneAt: new Map() }),
      reveal: (frameId) => canvas.reveal(frameId),
    })
    drivers.set(key, driver)
  }
  return driver
}

/** The snapshot in the Thumbnail Capturer's browser, at the page's size. */
const renderSnapshot: RenderSnapshot = async (snapshot) => {
  const html = snapshotDocument(snapshot)
  const url = `data:text/html;base64,${Buffer.from(html).toString("base64")}`
  if (url.length > MAX_DOCUMENT_BYTES) {
    throw new Error("the page is too large to render")
  }
  const size = {
    width: Math.max(1, Math.round(snapshot.viewport.width)),
    height: Math.max(1, Math.round(snapshot.viewport.height)),
  }
  return encodeShot(await thumbnailCapturer.capture(url, size), size)
}
