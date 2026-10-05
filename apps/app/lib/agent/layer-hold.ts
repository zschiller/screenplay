import { heldByOther } from "@/lib/canvas/layer-chat"
import type { ChatSessionData } from "@/lib/types"
import { COLLECTION_KEYS, type RoomCollections } from "@/lib/yjs/schema"

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
