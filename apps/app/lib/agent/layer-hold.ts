import { tool } from "ai"
import { z } from "zod"

import { annotateTools } from "@/lib/mcp/tool-server"
import type { RoomDoc } from "@/lib/room-access"
import { heldByOther } from "@/lib/canvas/layer-chat"
import type { ChatSessionData } from "@/lib/types"
import {
  COLLECTION_KEYS,
  createRoomCollections,
  type RoomCollections,
} from "@/lib/yjs/schema"

/**
 * The hold check a Mockup or Document tool runs inside the room-doc mutation
 * that applies its edit (#1725), so no other chat's hold can land between the
 * check and the write. When another chat holds the layer, returns the refusal
 * the agent reads, and the caller writes nothing. Otherwise records the layer
 * in this chat's working list (keeping when it first started on it), which
 * covers an Engine that doesn't stream tool arguments and a layer the call
 * just made, and returns null.
 */
export function holdLayer(
  c: RoomCollections,
  chatId: string,
  layerId: string
): string | null {
  // Straight from the doc: a collection's cached snapshot can read stale.
  const chats = Object.values(
    c.doc.getMap(COLLECTION_KEYS.chatSessions).toJSON()
  ) as ChatSessionData[]
  const holder = heldByOther(layerId, chatId, chats)
  if (holder) {
    return `${holder.label || "Another chat"} is changing this right now; tell the person and try again later.`
  }
  const chat = c.chatSessions.get(chatId)
  if (chat && chat.workingLayers?.[layerId] === undefined) {
    c.chatSessions.update(chatId, {
      workingLayers: { ...chat.workingLayers, [layerId]: Date.now() },
    })
  }
  return null
}

export interface LayerHoldToolContext {
  /** The turn's Room, opened through Room Access by the agent route. */
  room: RoomDoc
  /** The chat whose turn this is: the one that takes the hold. */
  chatId: string
}

/**
 * `start_editing`: the chat says which Mockup or Document it's about to
 * rewrite, before it writes the page. A desktop harness (Claude Code, Codex)
 * reports a call's arguments only once they're whole, so an `update_mockup`
 * names its Mockup only after the whole page is written, right before it
 * runs: without this, nothing shows on the Mockup while the chat writes it,
 * and another chat hears it's held only after writing a page of its own.
 * Taking the hold here shows the working dots from the start (the chat store
 * reads `layer_id` like any layer argument, `lib/chat/working-layer.ts`) and
 * refuses at once when another chat holds it.
 */
export function buildLayerHoldTools(ctx: LayerHoldToolContext) {
  const tools = {
    start_editing: tool({
      description:
        "Say which Mockup or Document you’re about to change, before you write the change: call it first, then update_mockup or the Document edit. The canvas shows this chat working on it until your turn ends, and no other chat can change it meanwhile. If another chat is changing it right now, it says so at once, before you write anything: tell the person who has it and carry on with the rest of your turn. Not needed for a Mockup or Document you create.",
      inputSchema: z.object({
        layer_id: z
          .string()
          .describe(
            "The Mockup’s or Document’s id, e.g. the one its create returned"
          ),
      }),
      execute: async ({ layer_id }) =>
        ctx.room.mutateDoc(({ doc }) => {
          const c = createRoomCollections(doc)
          const layer =
            c.mockupLayers.get(layer_id) ?? c.markdownLayers.get(layer_id)
          if (!layer) return `There’s no Mockup or Document ${layer_id}.`
          const refused = holdLayer(c, ctx.chatId, layer_id)
          if (refused) return refused
          return `You’re changing “${layer.title}” now; no other chat can change it until your turn ends.`
        }),
    }),
  }
  return annotateTools(tools, {
    start_editing: { destructiveHint: false, openWorldHint: false },
  })
}
