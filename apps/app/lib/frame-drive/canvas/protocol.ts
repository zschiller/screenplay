import type {
  DriveElement,
  DriveOp,
  DriveResult,
  DriveTarget,
} from "@/lib/frame-drive/contract"
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

/**
 * The steps of a gesture the Mac plays with real input (#1385), each one asked
 * of the canvas showing the frame: the frame's Sandbox Bridge finds the target
 * and reports what changed, as it does for a hosted frame's real input
 * (#1396), and the canvas hands the frame the input for the moment it lands.
 */
export type PageAsk =
  /** Find the target and scroll it into view; `focus` readies a field
   *  (`replace` selects its text) or focuses the element, for keys. */
  | {
      kind: "locate"
      target: DriveTarget
      focus?: "field" | "element"
      replace?: boolean
      show?: boolean
    }
  /** Draw the agent's cursor at show pace (the bridge's `drive-cursor`). */
  | { kind: "cursor"; what: PageCursor }
  /** What the page is now: its path, and a field's value. */
  | { kind: "state"; selector?: string }
  /**
   * Let the frame take the input about to land: the keyboard, and with `at`
   * (a point in the page) the pointer, which must hit the frame there.
   */
  | { kind: "take"; at?: { x: number; y: number } }
  /**
   * Hand the input back to the canvas, as it was before `take`. With `rest`
   * (after a hover) the pointer stays in the frame, so the page keeps its
   * hover, until the person's own pointer moves on the canvas or the next
   * gesture takes the input.
   */
  | { kind: "release"; rest?: boolean }

export type PageCursor =
  | { to: { x: number; y: number } }
  | { pause: true }
  | { press: true }
  | { linger: true }
  | { hide: true }

/** A target the bridge found, in the page's own CSS px. */
export type PageLocated = {
  target: Pick<DriveElement, "selector" | "tag" | "label"> | null
  x: number
  y: number
  /** It's a file input. */
  file?: boolean
  /** It opens one of the browser's own popups, which real input can't
   *  answer either. */
  popup?: "native-select" | "native-picker"
  /** False when `focus: "field"` found no text field. */
  field?: boolean
}

/** Where the window input for a point in the page lands, from `take`. */
export type PageTaken = {
  /** The point in the canvas window (CSS px), or null when the frame isn't
   *  there to hit (scrolled off, covered, or the window is hidden). */
  window: { x: number; y: number } | null
}

/** A page ask's answer when the frame isn't on the canvas or can't take real
 *  input: the gesture goes through the bridge instead. */
export const PAGE_UNSUPPORTED = "unsupported"

/** What `state` reads. */
export type PageState = { path: string; value?: string }

/** The answer to each {@link PageAsk}; "taken" when the agent no longer
 *  drives the frame, null when it isn't loaded or the bridge didn't answer. */
export type PageAnswer<K extends PageAsk["kind"]> =
  | (K extends "locate"
      ? PageLocated | null
      : K extends "take"
        ? PageTaken
        : K extends "state"
          ? PageState
          : null)
  | "taken"
  | null

export type ServerToCanvas =
  | { type: "op"; id: string; frameId: string; op: DriveOp }
  | { type: "where"; id: string; frameId: string }
  /** The page as it is now, where no native snapshot of the canvas exists
   *  (a mockup on hosted). */
  | { type: "snapshot"; id: string; frameId: string }
  /** Bring the frame into view on this canvas (#1390). */
  | { type: "reveal"; id: string; frameId: string }
  /** One step of a gesture played with real input (#1385). */
  | { type: "page"; id: string; frameId: string; ask: PageAsk }

export type CanvasToServer =
  /** The frames this canvas has mounted, sent on connect and on change. */
  | { type: "frames"; frameIds: string[] }
  | { type: "result"; id: string; result: DriveResult }
  | { type: "where"; id: string; where: FrameWhere }
  /** Null when the frame isn't loaded or its page didn't answer. */
  | { type: "snapshot"; id: string; snapshot: PageInView | null }
  | { type: "revealed"; id: string; ok: boolean }
  | { type: "page"; id: string; value: unknown }

/** An answer to one of the server's messages. */
export type CanvasAnswer = Exclude<CanvasToServer, { type: "frames" }>
