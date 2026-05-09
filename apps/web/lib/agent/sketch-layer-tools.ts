import "server-only"

import { tool, jsonSchema } from "ai"
import { mutateRoomDoc } from "@/lib/yjs/server"

/**
 * *Write* tools for a chat session targeting a sketch layer — replace the
 * full HTML, retitle. The matching `read_sketch` tool lives in
 * `layer-read-tools.ts` and is mixed into every chat target's toolset, so
 * any chat (agent, doc, sketch) can fetch a sketch by id.
 *
 * Knobs and shared state aren't first-class tools: the model declares them
 * by writing `screenplay.knob({...})` and `screenplay.state.set("...", ...)`
 * calls into the HTML, and the runtime bootstrap injected into every sketch
 * wires them up to the canvas via postMessage.
 */
export interface SketchLayerToolContext {
  roomId: string
  sketchLayerId: string
}

/** Soft cap on `html` size. Generous enough for a moderately complex sketch
 *  with embedded styles and scripts; rejects pathological pastes that would
 *  blow up the Yjs update or thumbnail generation. */
const MAX_SKETCH_HTML_BYTES = 256 * 1024

export function buildSketchLayerTools(ctx: SketchLayerToolContext) {
  return {
    replace_sketch_html: tool({
      description:
        "Replace the sketch's full HTML. The value should be a complete document body — typically a `<style>` block, the markup, and a `<script>` block. The runtime bootstrap (which exposes `window.screenplay.knob`, `window.screenplay.state`) is prepended automatically by the canvas; don't include your own. Soft cap of 256KB.",
      inputSchema: jsonSchema<{ html: string }>({
        type: "object",
        properties: { html: { type: "string" } },
        required: ["html"],
      }),
      execute: async (input) => {
        const html = (input as { html: string }).html
        if (typeof html !== "string") return "Error: `html` must be a string."
        const bytes =
          typeof Buffer !== "undefined"
            ? Buffer.byteLength(html, "utf8")
            : new TextEncoder().encode(html).length
        if (bytes > MAX_SKETCH_HTML_BYTES) {
          return `Error: HTML is ${bytes} bytes, over the ${MAX_SKETCH_HTML_BYTES}-byte cap. Trim the document and retry.`
        }
        await mutateRoomDoc(ctx.roomId, ({ sketchLayers }) => {
          if (!sketchLayers.get(ctx.sketchLayerId)) return
          sketchLayers.update(ctx.sketchLayerId, { html })
        })
        return `Replaced sketch HTML (${bytes} bytes).`
      },
    }),

    set_sketch_title: tool({
      description:
        "Update the sketch's title — shown in the sidebar and target picker. Use a short, descriptive label.",
      inputSchema: jsonSchema<{ title: string }>({
        type: "object",
        properties: { title: { type: "string" } },
        required: ["title"],
      }),
      execute: async (input) => {
        const title = (input as { title: string }).title
        await mutateRoomDoc(ctx.roomId, ({ sketchLayers }) => {
          if (!sketchLayers.get(ctx.sketchLayerId)) return
          sketchLayers.update(ctx.sketchLayerId, { title })
        })
        return `Title set to "${title}".`
      },
    }),
  }
}

export type SketchLayerTools = ReturnType<typeof buildSketchLayerTools>
