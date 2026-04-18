export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

export type DomRect = { x: number; y: number; width: number; height: number }
export type DomOp = "querySelector" | "getRect" | "getOuterHTML"

// Canvas -> Iframe
export type CanvasToIframeMessage =
  | { type: "screenplay:init"; state: JsonObject }
  | { type: "screenplay:state-update"; state: JsonObject }
  | { type: "screenplay:dom-query"; id: string; op: DomOp; selector?: string; handle?: string }
  | { type: "screenplay:pick-start"; id: string }
  | { type: "screenplay:pick-stop"; id: string }

// Iframe -> Canvas
export type IframeToCanvasMessage =
  | { type: "screenplay:ready" }
  | { type: "screenplay:state-changed"; state: JsonObject }
  | { type: "screenplay:dom-result"; id: string; ok: true; value: JsonValue }
  | { type: "screenplay:dom-result"; id: string; ok: false; error: string }
  | { type: "screenplay:picked"; handle: string; selector: string; rect: DomRect; outerHTML: string }
  | { type: "screenplay:hover"; rect: DomRect | null }
  | { type: "screenplay:navigation"; path: string }

export function isScreenplayMessage(
  data: unknown,
): data is CanvasToIframeMessage | IframeToCanvasMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    "type" in data &&
    typeof (data as { type: unknown }).type === "string" &&
    (data as { type: string }).type.startsWith("screenplay:")
  )
}
