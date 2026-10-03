/**
 * Frame Drive — the one contract for the agent driving a frame (spec #1386,
 * ticket #1389).
 *
 * The agent drives a frame with a fixed set of gestures (click, type, key,
 * scroll, select, drag) and reads (the page's interactive elements, a
 * screenshot). There is no op that runs the agent's own script in the page:
 * driving a frame must never become running arbitrary code (#1367).
 *
 * Each runtime has a backend that applies the ops: the Mac relays them to the
 * Sandbox Bridge in the person's own frame or mockup (`mac/`), hosted relays a
 * mockup's to the asker's canvas through the Room's doc (`view/`, #1391), and
 * sends a frame's to its shared browser as real input (`hosted/`, #1396).
 * Every backend passes the same contract suite (`contract-suite.ts`), so what
 * the agent can do doesn't depend on where Screenplay runs. Who may drive is
 * Frame Control's call, applied in front of every backend by the agent's
 * driver (`agent-driver.ts`).
 */

/**
 * What an op acts on, found by reading the elements first: a CSS selector
 * from {@link DriveElements}, an element's visible label, or a point in the
 * frame's viewport (CSS px).
 */
export type DriveTarget = {
  selector?: string
  text?: string
  x?: number
  y?: number
}

export type DriveModifiers = {
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}

/**
 * How fast a gesture plays (#1383), set by what the person asked for.
 * - `show` ("show me"): at a pace they can watch. A cursor glides to the
 *   target and pauses before acting, typing goes in a character at a time,
 *   and scrolls and drags move smoothly.
 * - `jump` ("get it into that state"): at once, with nothing drawn.
 */
export type DrivePace = "show" | "jump"

type Paced = { pace?: DrivePace }

/** The gestures. Each one changes the page, so each one needs control. */
export type DriveGesture = Paced &
  (
    | { op: "click"; target: DriveTarget }
    | { op: "type"; target: DriveTarget; text: string; replace?: boolean }
    | {
        op: "key"
        key: string
        modifiers?: DriveModifiers
        target?: DriveTarget
      }
    | { op: "scroll"; target?: DriveTarget; dx?: number; dy?: number }
    | { op: "select"; target: DriveTarget; value: string }
    | { op: "drag"; target: DriveTarget; to: DriveTarget }
  )

/** The reads. They don't change the page, so they don't need control. */
export type DriveRead = { op: "elements"; selector?: string }

export type DriveOp = DriveGesture | DriveRead

/**
 * Every op there is. Nothing outside this list reaches a page: backends refuse
 * any other op before it leaves the server, and the bridge refuses it again.
 */
export const DRIVE_OPS = [
  "click",
  "type",
  "key",
  "scroll",
  "select",
  "drag",
  "elements",
] as const satisfies readonly DriveOp["op"][]

export type DriveOpName = (typeof DRIVE_OPS)[number]

export function isDriveOp(op: unknown): op is DriveOp {
  return (
    !!op &&
    typeof op === "object" &&
    (DRIVE_OPS as readonly unknown[]).includes((op as { op?: unknown }).op)
  )
}

export function isGesture(op: DriveOp): op is DriveGesture {
  return op.op !== "elements"
}

/** An element as a read or a gesture reports it. */
export type DriveElement = {
  /** A selector that finds it again; pass it back as a target. */
  selector: string
  tag: string
  role?: string
  type?: string
  /** Its label: aria-label, its label element, placeholder, text or title. */
  label: string
  value?: string
  checked?: boolean
  disabled?: boolean
  /** Whether it's inside the frame's viewport now. */
  inViewport: boolean
}

/** What `elements` reads: where the page is and what can be acted on. */
export type DriveElements = {
  path: string
  title: string
  viewport: { width: number; height: number }
  scroll: { x: number; y: number }
  elements: DriveElement[]
  /** With a selector: that element's text and form state, or null. */
  read?: {
    text: string
    value?: string
    checked?: boolean
  } | null
}

/** What a gesture did. */
export type DriveDone = {
  op: DriveGesture["op"]
  /** The element it acted on, when it had one. */
  target?: Pick<DriveElement, "selector" | "tag" | "label"> | null
  /** The page's path after the gesture painted. */
  path: string
  /** A field's value after `type` or `select`. */
  value?: string
  /** For `scroll`: where the scroller ended up. */
  scrolled?: { x: number; y: number }
  /** For `key`: the browser's default action Screenplay ran for it, if any
   *  (Enter submits the form). */
  emulated?: string
}

/**
 * What the agent can't do in a page. A gesture that hits one returns the gap
 * instead of pretending it worked, so the agent asks the person to do that
 * step.
 *
 * - Anywhere: a file picker, because the agent has no file of the person's
 *   to give it.
 * - Where the Sandbox Bridge drives a page in a person's own canvas (a frame
 *   on the Mac, a Mockup anywhere, #1391), everything else here: its input
 *   is synthetic, so nothing the browser itself does for a real gesture
 *   happens (#1367). Trusted input that would close them on the Mac is
 *   #1385. A hosted frame's shared browser (#1396) takes real input and has
 *   none of these.
 */
export const DRIVE_GAPS = {
  "file-picker":
    "Choosing a file needs a file from the person's computer, which the agent can't pick.",
  clipboard:
    "The page used the clipboard, which the agent can't reach in this page, so the copy or paste didn't happen.",
  "rich-text":
    "Typing into a rich-text editor needs the keyboard focus, which the agent can't move into this page.",
  "key-typing":
    "A key event doesn't type its character in this page. Use frame_type to enter text.",
  tab: "Tab doesn't move the focus in this page.",
  "native-select":
    "A native select's popup can't be opened in this page. Use frame_select to pick an option.",
  "native-picker":
    "The browser's own picker (date, time or colour) can't be opened in this page. Use frame_type to set the field's value.",
} as const

export type DriveGap = keyof typeof DRIVE_GAPS

/** The outcome of one op, the same for every backend. */
export type DriveResult =
  | { status: "done"; value: DriveDone }
  | { status: "read"; value: DriveElements }
  /** The gesture needs something the runtime can't do; nothing happened,
   *  or (clipboard) only the part before it did. */
  | { status: "gap"; gap: DriveGap; target?: DriveDone["target"] }
  /** No element matches the target. */
  | { status: "not-found"; target: DriveTarget }
  /** Control moved away from the agent before the gesture ran. */
  | { status: "taken" }
  /** The frame can't be reached (the canvas isn't open, the page isn't
   *  running, the bridge didn't answer). */
  | { status: "unavailable"; reason: string }
  | { status: "failed"; reason: string }

/** A screenshot of the frame as the person sees it. */
export type DriveScreenshot = {
  data: Buffer
  mediaType: string
  /** What it shows, for the caption: clipped, scaled, in the background. */
  note?: string
}

export type DriveScreenshotResult =
  | { status: "shot"; shot: DriveScreenshot }
  | { status: "unavailable"; reason: string }

/** One runtime's way of applying ops to a frame. */
export interface FrameDriveBackend {
  /**
   * Whether the frame can be driven right now, before anyone asks Frame
   * Control for it: null when it can, otherwise why not. Without a frame,
   * whether any frame on the canvas could be (the canvas is open).
   */
  unavailable(frameId?: string): Promise<string | null>
  run(frameId: string, op: DriveOp): Promise<DriveResult>
  screenshot(frameId: string): Promise<DriveScreenshotResult>
  /**
   * Bring the frame into view on the canvas of the person who asked, and
   * nobody else's (#1383). Null when it did, otherwise why not.
   */
  reveal(frameId: string): Promise<string | null>
}
