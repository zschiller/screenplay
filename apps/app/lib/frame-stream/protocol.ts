/**
 * Frame Stream wire protocol (#1392): what the canvas and the in-Sandbox
 * service (`lib/sandbox-bridge/frame-stream.mjs`) say to each other over a
 * Workspace's one stream WebSocket. Isomorphic and React-free.
 *
 * Control messages are JSON text. Video is binary:
 * `[1][flags][u16 frame id length][frame id][access unit]`, flags bit 0 set
 * on a keyframe.
 */

/** Messages the canvas sends. `auth` must come first, within 5 seconds. */
export type FrameStreamClientMessage =
  | { t: "auth"; token: string }
  /** Start streaming a frame, starting its browser at `route` if needed. */
  | { t: "watch"; frame: string; route: string; width: number; height: number }
  | { t: "unwatch"; frame: string }
  /** The frame's CSS size changed. */
  | { t: "size"; frame: string; width: number; height: number }
  /** The room's route for the frame; the browser goes there unless it's
   *  already on it. */
  | { t: "navigate"; frame: string; route: string }
  | { t: "reload"; frame: string }
  /** A drive grant the app signed for this viewer and frame. */
  | { t: "drive"; frame: string; token: string }
  | { t: "release"; frame: string }
  | ({ t: "input"; frame: string } & FrameStreamInput)

/** Driver input, in the frame's CSS pixels. Applied only for the driver. */
export type FrameStreamInput =
  | {
      kind: "mouse"
      type: "mousePressed" | "mouseReleased" | "mouseMoved"
      x: number
      y: number
      button: "left" | "middle" | "right" | "none"
      buttons: number
      clickCount: number
      modifiers: number
    }
  | {
      kind: "wheel"
      x: number
      y: number
      deltaX: number
      deltaY: number
      modifiers: number
    }
  | {
      kind: "key"
      type: "keyDown" | "keyUp" | "rawKeyDown"
      key: string
      code: string
      text?: string
      keyCode: number
      repeat: boolean
      modifiers: number
    }
  | { kind: "text"; text: string }

export type FrameStreamStatus = "starting" | "live" | "restarting" | "failed"

/** Messages the service sends. */
export type FrameStreamServerMessage =
  | { t: "ready"; codec: "h264" | "vp8" }
  | {
      t: "frame"
      frame: string
      status: FrameStreamStatus
      width: number
      height: number
      /** The encoded picture's size: about twice the CSS size. */
      videoWidth: number
      videoHeight: number
    }
  /** The page's path (with query and hash) on the frame's origin. */
  | { t: "route"; frame: string; path: string }
  | { t: "error"; frame?: string; message: string }

export type FrameStreamVideo = {
  frame: string
  key: boolean
  data: Uint8Array
}

/** Decode a binary video message, or null when it isn't one. */
export function decodeVideoMessage(buf: Uint8Array): FrameStreamVideo | null {
  if (buf.length < 4 || buf[0] !== 1) return null
  const idLength = (buf[2]! << 8) | buf[3]!
  if (buf.length < 4 + idLength) return null
  return {
    frame: new TextDecoder().decode(buf.subarray(4, 4 + idLength)),
    key: (buf[1]! & 1) === 1,
    data: buf.subarray(4 + idLength),
  }
}

/** CDP modifier bits from a DOM event: Alt 1, Ctrl 2, Meta 4, Shift 8. */
export function modifiersOf(e: {
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}): number {
  return (
    (e.altKey ? 1 : 0) |
    (e.ctrlKey ? 2 : 0) |
    (e.metaKey ? 4 : 0) |
    (e.shiftKey ? 8 : 0)
  )
}

/** CDP's button name for a DOM `MouseEvent.button`. */
export function mouseButtonOf(
  button: number
): "left" | "middle" | "right" | "none" {
  return button === 0
    ? "left"
    : button === 1
      ? "middle"
      : button === 2
        ? "right"
        : "none"
}

/**
 * The WebCodecs codec string for an H.264 stream, from the first sequence
 * parameter set in an Annex B access unit (`avc1.PPCCLL`: profile,
 * constraint flags, level). Null when the unit carries no SPS. A keyframe
 * always does: the encoder repeats its headers.
 */
export function h264CodecOf(au: Uint8Array): string | null {
  for (let i = 0; i + 6 < au.length; i++) {
    if (au[i] !== 0 || au[i + 1] !== 0 || au[i + 2] !== 1) continue
    if ((au[i + 3]! & 0x1f) !== 7) continue
    const hex = (n: number) => n.toString(16).padStart(2, "0")
    return `avc1.${hex(au[i + 4]!)}${hex(au[i + 5]!)}${hex(au[i + 6]!)}`
  }
  return null
}
