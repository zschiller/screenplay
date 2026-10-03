/**
 * Frame Stream wire protocol (#1392): what the canvas and the in-Sandbox
 * service (`lib/sandbox-bridge/frame-stream.mjs`) say to each other over a
 * Workspace's one stream WebSocket. Isomorphic and React-free.
 *
 * Control messages are JSON text. Video is binary:
 * `[1][flags][u16 frame id length][frame id][access unit]`, flags bit 0 set
 * on a keyframe.
 */

import type { DriveOp, DriveResult } from "@/lib/frame-drive/contract"
import type {
  CanvasToIframeMessage,
  IframeToCanvasMessage,
} from "@/lib/postmessage-protocol"

/** Messages the canvas sends. `auth` must come first, within 5 seconds. */
export type FrameStreamClientMessage =
  | { t: "auth"; token: string }
  /** Start streaming a frame, starting its browser at `route` if needed. */
  | {
      t: "watch"
      frame: string
      route: string
      width: number
      height: number
      scheme?: FrameColorScheme
    }
  | { t: "unwatch"; frame: string }
  /** The frame's CSS size changed. */
  | { t: "size"; frame: string; width: number; height: number }
  /** The room's route for the frame; the browser goes there unless it's
   *  already on it. */
  | { t: "navigate"; frame: string; route: string }
  | { t: "reload"; frame: string }
  /** The room's colour scheme for the frame's page (its Theme knob). */
  | { t: "scheme"; frame: string; scheme: FrameColorScheme }
  /** A drive grant the app signed for this viewer and frame. */
  | { t: "drive"; frame: string; token: string }
  | { t: "release"; frame: string }
  | ({ t: "input"; frame: string } & FrameStreamInput)
  /** For the Sandbox Bridge in the shared page (#1394): what the canvas
   *  would post into a local iframe. Reads from any viewer; room changes
   *  only from the frame's primary. */
  | { t: "bridge"; frame: string; message: CanvasToIframeMessage }
  /** The agent's Frame Drive op (#1396), from the app's agent connection
   *  only. `route` and the size start the frame when nobody watches it; a
   *  gesture carries an agent grant. */
  | ({ t: "agent"; id: string; op: DriveOp; grant?: string } & AgentFrame)
  /** A screenshot of the shared page for the agent. */
  | ({ t: "agent-shot"; id: string } & AgentFrame)
  /** Read the page's URL, cookies and local storage, for a viewer going
   *  local (#1397). Answered by a `snapshot` with the same `id`. */
  | { t: "snapshot"; frame: string; id: string }
  /** Copy (or cut) what's selected in the shared page, for the driver's own
   *  clipboard. Answered by a `clipboard` with the same `id`. */
  | { t: "clipboard"; frame: string; id: string; cut: boolean }

/** What the shared page's `prefers-color-scheme` matches. */
export type FrameColorScheme = "light" | "dark"

/** Where the agent's frame starts when it isn't running. */
export type AgentFrame = {
  frame: string
  route: string
  width: number
  height: number
}

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
  /** What the shared page's bridge posted to its parent: a read's answer to
   *  whoever asked, what the room records to the primary. */
  | { t: "bridge"; frame: string; message: IframeToCanvasMessage }
  /** The outcome of the agent's op. */
  | { t: "agent-result"; id: string; result: DriveResult }
  /** The agent's screenshot, base64, or why there's none. */
  | {
      t: "agent-shot"
      id: string
      shot?: { data: string; mediaType: string }
      reason?: string
    }
  /** The answer to a client `snapshot`; `error` when the page couldn't be
   *  read (it isn't live yet). */
  | ({ t: "snapshot"; frame: string; id: string } & (
      FrameSnapshot | { error: string }
    ))
  /** The answer to a client `clipboard`: what the page copied, or null when
   *  nothing was selected or this viewer doesn't drive the frame. */
  | { t: "clipboard"; frame: string; id: string; text: string | null }

/** What a viewer going local starts from (#1397): the shared page's path on
 *  the frame's origin, its cookies and its local storage. */
export type FrameSnapshot = {
  path: string
  cookies: FrameCookie[]
  localStorage: [string, string][]
}

/** A cookie of the shared page, as CDP reports it. `expires` is seconds since
 *  the epoch, or -1 for a session cookie. */
export type FrameCookie = {
  name: string
  value: string
  path: string
  expires: number
  httpOnly: boolean
  secure: boolean
  sameSite?: "Strict" | "Lax" | "None"
}

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

/**
 * Counts presses into double and triple clicks, as the OS does for a page of
 * its own: a pointer event's `detail` is always 0, and the shared page fires
 * `dblclick` only when the second press says it's the second.
 */
export function clickCounter(intervalMs = 500, slopPx = 4) {
  let last: {
    button: number
    x: number
    y: number
    at: number
    count: number
  } | null = null
  return (button: number, x: number, y: number, at: number): number => {
    const count =
      last &&
      last.button === button &&
      at - last.at <= intervalMs &&
      Math.abs(x - last.x) <= slopPx &&
      Math.abs(y - last.y) <= slopPx
        ? last.count + 1
        : 1
    last = { button, x, y, at, count }
    return count
  }
}

type KeyLike = {
  key: string
  code: string
  keyCode: number
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/**
 * A key as the shared page's browser expects it. That browser is Chrome on
 * Linux, so a Mac viewer's shortcuts go as their Linux equivalents: ⌘ as
 * Ctrl (⌘A, ⌘Z), ⌘← and ⌘→ as Home and End, ⌘↑ and ⌘↓ as Ctrl+Home and
 * Ctrl+End, and ⌥ word moves and deletes as Ctrl ones.
 */
export function pageKeyOf(
  e: KeyLike,
  mac: boolean
): { key: string; code: string; keyCode: number; modifiers: number } {
  const same = {
    key: e.key,
    code: e.code,
    keyCode: e.keyCode,
    modifiers: modifiersOf(e),
  }
  if (!mac) return same
  const shift = e.shiftKey ? 8 : 0
  if (e.metaKey && !e.altKey && !e.ctrlKey) {
    const home = { key: "Home", code: "Home", keyCode: 36 }
    const end = { key: "End", code: "End", keyCode: 35 }
    if (e.key === "ArrowLeft") return { ...home, modifiers: shift }
    if (e.key === "ArrowRight") return { ...end, modifiers: shift }
    if (e.key === "ArrowUp") return { ...home, modifiers: 2 | shift }
    if (e.key === "ArrowDown") return { ...end, modifiers: 2 | shift }
  }
  if (
    e.altKey &&
    !e.metaKey &&
    !e.ctrlKey &&
    ["ArrowLeft", "ArrowRight", "Backspace", "Delete"].includes(e.key)
  )
    return { ...same, modifiers: 2 | shift }
  // ⌘ for Ctrl; a Ctrl the viewer held stays Ctrl.
  const m = same.modifiers
  return { ...same, modifiers: m & 4 ? (m & ~4) | 2 : m }
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
 * The colours the Frame Stream service encodes in: BT.601 limited range from
 * the sRGB screen, the conversion ffmpeg makes by default. The decoder must be
 * told so: a browser guesses BT.709 for a stream that doesn't say, which
 * shifts saturated colours by up to a tenth (#1392 follow-up). The H.264
 * stream also carries this in its headers.
 */
export const FRAME_STREAM_COLOR_SPACE: VideoColorSpaceInit = {
  primaries: "bt709",
  transfer: "iec61966-2-1",
  matrix: "smpte170m",
  fullRange: false,
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
