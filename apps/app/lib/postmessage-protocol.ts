export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type DomRect = { x: number; y: number; width: number; height: number }
export type DomOp =
  | "querySelector"
  | "getRect"
  | "getOuterHTML"
  | "elementAtPoint"
  | "getRectsForSelectors"
  | "getDocumentSize"

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
      handle?: string
      x?: number
      y?: number
    }
  | { type: "screenplay:pick-start"; id: string }
  | { type: "screenplay:pick-stop"; id: string }
  | { type: "screenplay:set-forward-input"; id: string; enabled: boolean }
  | { type: "screenplay:knob-values"; values: JsonObject }
  | { type: "screenplay:cursor-mode"; mode: CursorMode }
  | { type: "screenplay:shared-state-apply"; state: JsonObject }

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
  | { type: "screenplay:navigation"; path: string; replace?: boolean }
  | { type: "screenplay:scroll"; scrollX: number; scrollY: number }
  | { type: "screenplay:hmr-status"; status: HmrStatus }
  | { type: "screenplay:knobs-declared"; knobs: JsonValue[] }
  | { type: "screenplay:shared-state"; state: JsonObject }

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
