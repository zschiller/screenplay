import "server-only"

import { tool, jsonSchema } from "ai"
import { readRoomDoc } from "@/lib/yjs/server"
import { documentFragment, fragmentBodyToPlainText } from "@/lib/yjs/fragment-text"

/**
 * Cross-cutting "read another layer's contents" tools, available to every
 * chat target — agent (sandbox), markdown-layer. Each chat target's system
 * prompt advertises a layer directory (`<id>: <title>`) so the model can
 * resolve a title-only `@mention` (in the user's message or in a body it just
 * fetched) to the right id and call one of these.
 *
 * Read tools never *write* — they're safe to expose everywhere. The
 * write-side mutators stay private to each target's own toolset.
 */
export interface LayerReadToolContext {
  roomId: string
}

export function buildLayerReadTools(ctx: LayerReadToolContext) {
  return {
    read_document: tool({
      description:
        "Read a markdown document on the canvas by id. Returns the title plus the full body text. Use this to follow `@<title>`-style mentions (look up the id in the canvas layer directory baked into your system prompt).",
      inputSchema: jsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      }),
      execute: async (input) => {
        const id = (input as { id: string }).id
        const result = await readRoomDoc(ctx.roomId, ({ markdownLayers, doc }) => {
          const layer = markdownLayers.get(id)
          if (!layer) return null
          const fragment = documentFragment(doc, id)
          return {
            id,
            title: layer.title,
            body: fragmentBodyToPlainText(fragment),
          }
        })
        if (!result) return `Document not found: ${id}`
        return [
          `# ${result.title || "Untitled"}`,
          "",
          result.body || "(empty)",
        ].join("\n")
      },
    }),
  }
}

export type LayerReadTools = ReturnType<typeof buildLayerReadTools>
