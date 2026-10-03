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

/**
 * A tool result that carries a document for the model, such as a PDF a chat
 * opens from its saved files (#1514). Kept out of the transcript the same way
 * as an {@link ImageToolOutput}.
 */
export type FileToolOutput = {
  kind: "file"
  caption: string
  /** Base64-encoded file bytes. */
  data: string
  mediaType: string
  filename: string
}

export function isImageToolOutput(output: unknown): output is ImageToolOutput {
  return isMediaShaped(output) && (output as { kind: unknown }).kind === "image"
}

/** An image or a document for the model: the transcript keeps the caption. */
export function isMediaToolOutput(
  output: unknown
): output is ImageToolOutput | FileToolOutput {
  if (!isMediaShaped(output)) return false
  const o = output as Record<string, unknown>
  return (
    o.kind === "image" || (o.kind === "file" && typeof o.filename === "string")
  )
}

function isMediaShaped(output: unknown): boolean {
  if (!output || typeof output !== "object") return false
  const o = output as Record<string, unknown>
  return (
    typeof o.caption === "string" &&
    typeof o.data === "string" &&
    typeof o.mediaType === "string"
  )
}

/**
 * A tool's `toModelOutput` for results that may be an {@link ImageToolOutput}
 * or a {@link FileToolOutput}: the caption then the image or document, or
 * plain text for any other result.
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
  if (isMediaToolOutput(output) && output.kind === "file") {
    return {
      type: "content",
      value: [
        { type: "text", text: output.caption },
        {
          type: "file-data",
          data: output.data,
          mediaType: output.mediaType,
          filename: output.filename,
        },
      ],
    }
  }
  return {
    type: "text",
    value: typeof output === "string" ? output : JSON.stringify(output),
  }
}
