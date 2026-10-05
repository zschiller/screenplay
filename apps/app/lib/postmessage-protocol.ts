import type { DriveOp, DriveTarget } from "@/lib/frame-drive/contract"

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type DomRect = { x: number; y: number; width: number; height: number }
export type DomOp =
  | "querySelector"
  | "getRect"
  | "getOuterHTML"
  | "elementAtPoint"
  | "getRectsForSelectors"
  | "resolveAnchors"
  | "getDocumentSize"
  | "getPageSnapshot"

export type HmrStatus = "connected" | "reconnecting" | "disconnected"

export type CursorMode = "default" | "touch"

// Canvas -> Iframe
export type CanvasToIframeMessage =
  | { type: "screenplay:init"; state: JsonObject }
  | { type: "screenplay:state-update"; state: JsonObject }
  | { type: "screenplay:scroll-to"; scrollX: number; scrollY: number }
  | {
      type: "screenplay:dom-query"
      id: string
      op: DomOp
      selector?: string
      selectors?: string[]
      /** `resolveAnchors`: comment anchors (`ElementAnchor`) to look up. */
      anchors?: unknown[]
      handle?: string
      x?: number
      y?: number
      /** `getPageSnapshot`: also carry form state and scroll (#1391). */
      live?: boolean
    }
  | { type: "screenplay:pick-start"; id: string }
  | { type: "screenplay:pick-stop"; id: string }
  | { type: "screenplay:set-forward-input"; id: string; enabled: boolean }
  // Follow another viewer's route client-side (#999). Answered with a
  // `dom-result` whose value is true when the page's router took the route.
  | { type: "screenplay:navigate"; id: string; path: string }
  // Frame Drive (#1389): one agent op, answered with a `dom-result` whose
  // value is a `DriveResult`; `drive-stop` ends a gesture still running.
  | { type: "screenplay:drive"; id: string; op: DriveOp }
  | { type: "screenplay:drive-stop"; id: string }
  // The Mac's real input (#1385), as a shared frame's (#1396): where a
  // target is, the agent's cursor at show pace, and what a gesture left.
  | {
      type: "screenplay:drive-locate"
      id: string
      target: DriveTarget
      focus?: "field" | "element"
      replace?: boolean
      show?: boolean
    }
  | ({ type: "screenplay:drive-cursor"; id: string } & Record<string, unknown>)
  | { type: "screenplay:drive-state"; id: string; selector?: string }
  | { type: "screenplay:knob-values"; values: JsonObject }
  | { type: "screenplay:cursor-mode"; mode: CursorMode }
  // `initial` marks the answer to `screenplay:shared-state-request`: the
  // room's whole state, which the frame waits for before it publishes.
  | {
      type: "screenplay:shared-state-apply"
      state: JsonObject
      initial?: boolean
    }
  // A Mockup's open question (#1644), or null: the answer to
  // `screenplay:question-request`, then again on every change.
  | { type: "screenplay:question-apply"; question: PageQuestion | null }

/** The question a Mockup page sees (`screenplay.question()`, #1644). */
export interface PageQuestion {
  /** The question call's id, which an answer names. */
  id: string
  question: string
  options: { label: string; detail?: string }[]
  recommended: number | null
  /** Null while open; `index` is null when the reply wasn't an option. */
  answer: { index: number | null } | null
  /**
   * Whether a tap on the page can answer it at all: false on a live page or
   * while the agent drives it (`pageAnswers`), when `screenplay.answer`
   * returns false.
   */
  answerable: boolean
}

// Iframe -> Canvas
export type IframeToCanvasMessage =
  | { type: "screenplay:ready"; version?: string }
  | { type: "screenplay:state-changed"; state: JsonObject }
  | { type: "screenplay:dom-result"; id: string; ok: true; value: JsonValue }
  | { type: "screenplay:dom-result"; id: string; ok: false; error: string }
  | {
      type: "screenplay:picked"
      handle: string
      selector: string
      rect: DomRect
      outerHTML: string
      // The picked element's tag name (lowercase, e.g. `button`) and its `id`
      // attribute when present. Supplied explicitly so the composer's element
      // token derives its label from the real tag/id rather than regexing the
      // CSS selector. Optional so an older in-iframe bridge still parses.
      tagName?: string
      id?: string
    }
  | { type: "screenplay:hover"; rect: DomRect | null }
  | {
      type: "screenplay:wheel"
      deltaX: number
      deltaY: number
      ctrlKey: boolean
      metaKey: boolean
      clientX: number
      clientY: number
    }
  | { type: "screenplay:pan-start" }
  | { type: "screenplay:pan-delta"; dx: number; dy: number }
  | { type: "screenplay:pan-end" }
  | { type: "screenplay:space-down" }
  | { type: "screenplay:space-up" }
  // Esc pressed while focus is inside the preview, and the page didn't claim
  // it (a dialog closing calls preventDefault). Keydowns never cross the
  // iframe boundary, so the bridge forwards this one to leave interaction.
  | { type: "screenplay:escape" }
  | { type: "screenplay:navigation"; path: string; replace?: boolean }
  | { type: "screenplay:scroll"; scrollX: number; scrollY: number }
  | { type: "screenplay:hmr-status"; status: HmrStatus }
  | { type: "screenplay:knobs-declared"; knobs: JsonValue[] }
  | { type: "screenplay:shared-state"; state: JsonObject }
  // Sent by @screenplay.space/state when a frame loads, asking for the
  // room's current shared state before it publishes its own defaults.
  | { type: "screenplay:shared-state-request" }
  // A Mockup page's `screenplay.draft(text)` (#1645), sent from a tap: text
  // for the person to edit and send in the Mockup's chat.
  | { type: "screenplay:draft"; text: string }
  // A Mockup page asks for its open question, and answers it from a tap.
  | { type: "screenplay:question-request" }
  | { type: "screenplay:question-answer"; id: string; index: number }

export function isScreenplayMessage(
  data: unknown
): data is CanvasToIframeMessage | IframeToCanvasMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    typeof (data as { type: unknown }).type === "string" &&
    (data as { type: string }).type.startsWith("screenplay:")
  )
}
