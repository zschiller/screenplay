import type { DriveOp, DriveResult } from "@/lib/frame-drive/contract"
import type { PageSnapshot } from "@/lib/sandbox-bridge/page-snapshot"

/**
 * The asker's-canvas channel's messages: between the server and the canvas
 * the person who asked has open (`channel.ts`). On the Mac (#1389) they go
 * over a WebSocket on the local Yjs server's port, behind its gate (the
 * per-launch secret and the app's own Origin, #997, `mac/`); on hosted
 * (#1391) through the Room's doc and an answer route (`view/`).
 */

/** The path the channel answers on, beside the Yjs rooms. */
export const FRAME_DRIVE_PATH = "/__frame-drive"

/** The query parameter naming the Room the canvas shows. */
export const FRAME_DRIVE_ROOM_PARAM = "room"

/** Where a frame is in the canvas window, for the native snapshot. */
export type FrameWhere = {
  /** The iframe's rect in the window, in CSS px; null when not mounted. */
  rect: { x: number; y: number; width: number; height: number } | null
  window: { width: number; height: number }
  zoom: number
  visibility: string
}

/**
 * A page as it is now in the person's view, for a screenshot rendered away
 * from the canvas: its markup with form state written into it, the CSS that
 * styles it, and where it's scrolled to, at the size it lays out at. (Not a
 * shared frame's `FrameSnapshot`, which seeds its browser, #1396.)
 */
export type PageInView = PageSnapshot & {
  scroll: { x: number; y: number }
  viewport: { width: number; height: number }
}

export type ServerToCanvas =
  | { type: "op"; id: string; frameId: string; op: DriveOp }
  | { type: "where"; id: string; frameId: string }
  /** The page as it is now, where no native snapshot of the canvas exists
   *  (a mockup on hosted). */
  | { type: "snapshot"; id: string; frameId: string }
  /** Bring the frame into view on this canvas (#1390). */
  | { type: "reveal"; id: string; frameId: string }

export type CanvasToServer =
  /** The frames this canvas has mounted, sent on connect and on change. */
  | { type: "frames"; frameIds: string[] }
  | { type: "result"; id: string; result: DriveResult }
  | { type: "where"; id: string; where: FrameWhere }
  /** Null when the frame isn't loaded or its page didn't answer. */
  | { type: "snapshot"; id: string; snapshot: PageInView | null }
  | { type: "revealed"; id: string; ok: boolean }

/** An answer to one of the server's messages. */
export type CanvasAnswer = Exclude<CanvasToServer, { type: "frames" }>
