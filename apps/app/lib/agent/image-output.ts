import type { ToolResultPart } from "ai"

type ToolResultOutput = ToolResultPart["output"]

/**
 * A tool result that carries an image for the model, such as the Coordinator's
 * `view_frame` screenshot. The model sees the caption and the image (through
 * {@link imageModelOutput}); everything else that carries tool output (the
 * ACP record, the chat broadcast, the durable log) keeps only the caption, so
 * a screenshot never lands in Postgres or a Liveblocks event.
 */
export type ImageToolOutput = {
  kind: "image"
  /** What the image shows, in words. The only part the transcript keeps. */
  caption: string
  /** Base64-encoded image bytes. */
  data: string
  mediaType: string
}

export function isImageToolOutput(output: unknown): output is ImageToolOutput {
  if (!output || typeof output !== "object") return false
  const o = output as Record<string, unknown>
  return (
    o.kind === "image" &&
    typeof o.caption === "string" &&
    typeof o.data === "string" &&
    typeof o.mediaType === "string"
  )
}

/**
 * A tool's `toModelOutput` for results that may be an {@link ImageToolOutput}:
 * the caption then the image, or plain text for any other result.
 */
export function imageModelOutput({
  output,
}: {
  output: unknown
}): ToolResultOutput {
  if (isImageToolOutput(output)) {
    return {
      type: "content",
      value: [
        { type: "text", text: output.caption },
        { type: "image-data", data: output.data, mediaType: output.mediaType },
      ],
    }
  }
  return {
    type: "text",
    value: typeof output === "string" ? output : JSON.stringify(output),
  }
}
