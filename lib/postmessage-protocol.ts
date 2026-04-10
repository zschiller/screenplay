export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

export type JsonObject = { [key: string]: JsonValue }

// Canvas -> Iframe
export type CanvasToIframeMessage =
  | { type: "screenplay:init"; state: JsonObject }
  | { type: "screenplay:state-update"; state: JsonObject }

// Iframe -> Canvas
export type IframeToCanvasMessage =
  | { type: "screenplay:ready" }
  | { type: "screenplay:state-changed"; state: JsonObject }

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
