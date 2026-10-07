import { tool } from "ai"
import { z } from "zod"

import { annotateTools } from "@/lib/mcp/tool-server"
import type { RoomDoc } from "@/lib/room-access"
import { createCanvasOps } from "@/lib/canvas/ops"
import { createRoomCollections } from "@/lib/yjs/schema"
import { layerFileOf } from "@/lib/yjs/file-views"
import {
  PAGE_PARAM_DESCRIPTION,
  pickLayerPage,
  type SenderPage,
} from "@/lib/agent/layer-page"

/**
 * A chat's tool for putting a file on the canvas (#1885, spec #1882): a
 * Document or Mockup made without a view, or one that has views already,
 * gets another view beside the chat's layers, as Add to canvas on a file's
 * tile or modal does. The file itself doesn't change, so no hold is taken.
 */
export interface PlaceToolContext {
  /** The turn's Room, opened through Room Access by the agent route. */
  room: RoomDoc
  /** The chat whose turn this is: the view lands beside its layers. */
  chatId: string
  /** The page the turn's sender is on, where the view lands unless named. */
  senderPage?: SenderPage
}

export function buildPlaceTools(ctx: PlaceToolContext) {
  const tools = {
    add_to_canvas: tool({
      description:
        "Put a Document or Mockup on the canvas: adds a view of it on the sender’s page (or the page you name), beside this chat’s other layers there. Use it for a file you made without placing it, once the person wants it on the canvas, or for another view of a placed one. The file itself is unchanged, and every view shows the same file.",
      inputSchema: z.object({
        id: z
          .string()
          .describe(
            "The Document’s or Mockup’s id, e.g. the one its create returned"
          ),
        page: z.string().optional().describe(PAGE_PARAM_DESCRIPTION),
      }),
      execute: async ({ id, page }) => {
        const senderPageId = await ctx.senderPage?.()
        return ctx.room.mutateDoc(({ doc }) => {
          const c = createRoomCollections(doc)
          const file = layerFileOf(c, id)
          if (!file) return `There’s no Document or Mockup ${id}.`
          const picked = pickLayerPage(c, page, senderPageId)
          if ("error" in picked) return picked.error
          const placed = createCanvasOps(c, {
            currentPageId: () => picked.pageId,
          }).placeFile(file.id, { chatId: ctx.chatId })
          if (!placed) return "It couldn’t be placed. Try again."
          const noun = file.kind === "mockup" ? "Mockup" : "Document"
          return `Put ${noun} "${file.title || "Untitled"}" on the canvas (view id ${placed.viewId}).`
        })
      },
    }),
  }
  return annotateTools(tools, {
    add_to_canvas: { destructiveHint: false, openWorldHint: false },
  })
}
