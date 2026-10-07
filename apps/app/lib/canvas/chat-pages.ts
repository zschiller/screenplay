import type {
  ChatSessionData,
  IframeLayerData,
  IframeLayerGroupData,
  MarkdownLayerData,
  PageData,
} from "@/lib/types"
import { layerChats } from "./layer-chat"
import { getGroupMembers } from "./layout"
import { groupPageId } from "./pages"

/**
 * Where a chat's work is across Pages (#1841, spec #1834). No chat owns a
 * page: a chat's pages are those its Layers are on, its frames through its
 * Workspace and its Documents and Mockups through the holder / last-changed
 * rule (`layer-chat.ts`). The Chats menu names the first, the hover card all
 * of them, and picking the chat switches to the first and frames them.
 * React-free, tested against plain values.
 */

type Group = Pick<
  IframeLayerGroupData,
  "id" | "members" | "iframeLayerIds" | "pageId"
>

/**
 * The page each Layer and Group is on, by id: a Group's own, and each
 * Member's through its Group.
 */
export function pageIdsById(
  groups: readonly Group[],
  pages: readonly PageData[]
): Map<string, string> {
  const out = new Map<string, string>()
  for (const group of groups) {
    const pageId = groupPageId(group, pages)
    out.set(group.id, pageId)
    for (const m of getGroupMembers(group)) out.set(m.id, pageId)
  }
  return out
}

/**
 * Where a set of Layers is: the pages they're on in page order, and the ones
 * on each. A Layer no Group holds is on none.
 */
export interface LayerPlace {
  pages: PageData[]
  layerIdsByPage: Map<string, string[]>
}

/** {@link LayerPlace} of `layerIds`, read through {@link pageIdsById}. */
export function placeOfLayers(
  layerIds: Iterable<string>,
  pageOf: ReadonlyMap<string, string>,
  pages: readonly PageData[]
): LayerPlace {
  const layerIdsByPage = new Map<string, string[]>()
  for (const id of layerIds) {
    const pageId = pageOf.get(id)
    if (!pageId) continue
    const list = layerIdsByPage.get(pageId)
    if (list) list.push(id)
    else layerIdsByPage.set(pageId, [id])
  }
  return {
    pages: pages.filter((p) => layerIdsByPage.has(p.id)),
    layerIdsByPage,
  }
}

/**
 * Each chat's {@link LayerPlace}, keyed as the Chats menu keys its rows: a
 * Workspace's chat by its Workspace (Branch) id, a chat with no repository by
 * its own id. A chat with no Layers on any page is left out.
 */
export function chatPlaces({
  groups,
  pages,
  frames,
  documents,
  chats,
}: {
  groups: readonly Group[]
  pages: readonly PageData[]
  frames: readonly Pick<IframeLayerData, "id" | "branchId">[]
  documents: readonly Pick<
    MarkdownLayerData,
    "id" | "lastChangedByChatId" | "ownerChatId"
  >[]
  chats: readonly Pick<
    ChatSessionData,
    | "id"
    | "branchId"
    | "target"
    | "createdAt"
    | "isStreaming"
    | "closedAt"
    | "workingLayers"
  >[]
}): Map<string, LayerPlace> {
  const layersByChat = new Map<string, string[]>()
  const add = (key: string, layerId: string) => {
    const list = layersByChat.get(key)
    if (list) list.push(layerId)
    else layersByChat.set(key, [layerId])
  }
  for (const frame of frames) if (frame.branchId) add(frame.branchId, frame.id)
  for (const [layerId, chat] of layerChats(documents, chats)) {
    add(chat.kind === "workspace" ? chat.branchId : chat.chatId, layerId)
  }
  const pageOf = pageIdsById(groups, pages)
  const out = new Map<string, LayerPlace>()
  for (const [key, layerIds] of layersByChat) {
    const place = placeOfLayers(layerIds, pageOf, pages)
    if (place.pages.length > 0) out.set(key, place)
  }
  return out
}
