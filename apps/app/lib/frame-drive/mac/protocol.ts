import type { DriveOp, DriveResult } from "@/lib/frame-drive/contract"

/**
 * The Mac drive channel's messages (#1389): a WebSocket between the sidecar
 * and the canvas the person has open, on the local Yjs server's port and
 * behind its gate (the per-launch secret and the app's own Origin, #997).
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

export type ServerToCanvas =
  | { type: "op"; id: string; frameId: string; op: DriveOp }
  | { type: "where"; id: string; frameId: string }

export type CanvasToServer =
  /** The frames this canvas has mounted, sent on connect and on change. */
  | { type: "frames"; frameIds: string[] }
  | { type: "result"; id: string; result: DriveResult }
  | { type: "where"; id: string; where: FrameWhere }
