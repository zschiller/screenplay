import "server-only"

import { tool, jsonSchema } from "ai"
import { annotateTools } from "@/lib/mcp/tool-server"
import type { RoomReader } from "@/lib/room-access"
import { documentFragment } from "@/lib/yjs/fragment-text"
import { readDocumentBody, roomMentionLabels } from "@/lib/document-markdown"
import { mentionMarkdownNames } from "@/lib/mention-kinds"
import { layerPageName } from "@/lib/agent/layer-page"

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
  room: RoomReader
}

export function buildLayerReadTools(ctx: LayerReadToolContext) {
  const tools = {
    read_document: tool({
      description: `Read a markdown document on the canvas by id. Returns the page it’s on (on a canvas with more than one), then the title as a \`#\` heading, then the body as markdown; a comment quoting “Line N” means line N of that body, counting from the line after the title’s blank line. Mentions read \`[@<name>](mention:<kind>:<id>)\` with the current name, where kind is ${mentionMarkdownNames()}; read a \`document\` one with this tool. Use this to follow \`@<title>\`-style mentions (look up the id in the canvas layer directory baked into your system prompt).`,
      inputSchema: jsonSchema<{ id: string }>({
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      }),
      execute: async (input) => {
        const id = (input as { id: string }).id
        const result = await ctx.room.readDoc((c) => {
          const layer = c.markdownLayers.get(id)
          if (!layer) return null
          return {
            id,
            title: layer.title,
            page: layerPageName(c, { kind: "markdown-layer", id }),
            body: readDocumentBody(
              documentFragment(c.doc, id),
              roomMentionLabels(c)
            ),
          }
        })
        if (!result) return `Document not found: ${id}`
        return [
          ...(result.page ? [`Page: "${result.page}"`, ""] : []),
          `# ${result.title || "Untitled"}`,
          "",
          result.body || "(empty)",
        ].join("\n")
      },
    }),
  }
  // Reading changes nothing, so a harness never asks first.
  return annotateTools(tools, {
    read_document: { readOnlyHint: true, openWorldHint: false },
  })
}

export type LayerReadTools = ReturnType<typeof buildLayerReadTools>
