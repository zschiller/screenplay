import "server-only"

import { tool, jsonSchema } from "ai"
import { mutateRoomDoc, readRoomDoc } from "@/lib/yjs/server"

/**
 * Tools available to a chat session that targets a sketch layer. A sketch is
 * a single static-HTML document the iframe renders via `srcdoc`; editing it
 * means rewriting the `html` field on the layer in Yjs.
 *
 * The toolset is intentionally tiny — read, replace, retitle. Knobs and
 * shared state aren't first-class tools: the model declares them by writing
 * `screenplay.knob({...})` and `screenplay.state.set("...", ...)` calls into
 * the HTML, and the runtime bootstrap injected into every sketch wires them
 * up to the canvas via postMessage.
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
    read_sketch: tool({
      description:
        "Read the current state of the targeted sketch — its title, full HTML, declared knobs, and current shared-state values. Call this before rewriting if you need to confirm what's there or build on existing knobs.",
      inputSchema: jsonSchema<Record<string, never>>({
        type: "object",
        properties: {},
      }),
      execute: async () => {
        const result = await readRoomDoc(ctx.roomId, ({ sketchLayers }) => {
          const layer = sketchLayers.get(ctx.sketchLayerId)
          if (!layer) return null
          return {
            title: layer.title,
            html: layer.html,
            knobs: layer.knobs ?? [],
            sharedState: layer.sharedState ?? {},
          }
        })
        if (!result) return `Sketch not found: ${ctx.sketchLayerId}`
        return [
          `# ${result.title || "Untitled"}`,
          "",
          "HTML:",
          "```html",
          result.html || "(empty)",
          "```",
          "",
          `Declared knobs: ${JSON.stringify(result.knobs)}`,
          `Shared state: ${JSON.stringify(result.sharedState)}`,
        ].join("\n")
      },
    }),

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
