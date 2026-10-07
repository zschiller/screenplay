import { tool, jsonSchema, type ToolSet } from "ai"
import { getGroupMembers } from "@/lib/canvas/layout"
import { orderedPages } from "@/lib/canvas/pages"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import type { RoomToolPorts } from "@/lib/agent/room-tools"
import { annotateTools } from "@/lib/mcp/tool-server"

/**
 * The Coordinator's camera tool: `show_on_canvas` moves the view of the member
 * who asked to frames, documents, mockups or Groups, switching to the page
 * they're on (#1843), or to a page, or fits the page they're on. The
 * server only checks the ids and names them; the asker's canvas moves when it
 * sees the call complete in a turn it sent (`lib/canvas/view-requests.ts`).
 * The view is per member, so nobody else's moves.
 */
export function buildViewTools(readDoc: RoomToolPorts["readDoc"]): ToolSet {
  const tools = {
    show_on_canvas: tool({
      description:
        "Move the user’s view of the canvas to fit frames, documents, mockups or Groups by id, switching them to the page those are on first. Pass a page’s id to switch them to that page and fit it. Omit `ids` to fit the page they’re on. Only the view of the person who asked moves; nothing on the canvas changes.",
      inputSchema: jsonSchema<{ ids?: string[] }>({
        type: "object",
        properties: {
          ids: { type: "array", items: { type: "string" } },
        },
      }),
      execute: async ({ ids = [] }) =>
        readDoc((collections) => {
          // A fresh view: nothing observes a server doc, so a cached one reads stale.
          const c = createRoomCollections(collections.doc)
          if (ids.length === 0) return "Showed the whole page."
          const unknown = ids.filter((id) => !describe(c, id))
          if (unknown.length) {
            return `Error: no frame, document, mockup, Group or page ${unknown.join(", ")}.`
          }
          return `Showed ${ids.map((id) => describe(c, id)).join(", ")}.`
        }),
    }),
  }
  // Moves only the asker's own view.
  return annotateTools(tools, {
    show_on_canvas: { readOnlyHint: true, openWorldHint: false },
  })
}

/**
 * A frame, document, mockup, group or page by name, the way tool results name
 * them.
 */
function describe(c: RoomCollections, id: string): string | null {
  const frame = c.iframeLayers.get(id)
  if (frame) return `frame “${frame.label}”`
  const document = c.markdownLayers.get(id)
  if (document) return `document “${document.title || "Untitled"}”`
  const mockup = c.mockupLayers.get(id)
  if (mockup) return `mockup “${mockup.title || "Untitled"}”`
  const page = orderedPages(c.pages.toArray()).find((p) => p.id === id)
  if (page) return `page “${page.name}”`
  const group = c.iframeLayerGroups.get(id)
  if (group && getGroupMembers(group).length > 0) {
    return `group “${group.name ?? id}”`
  }
  return null
}
