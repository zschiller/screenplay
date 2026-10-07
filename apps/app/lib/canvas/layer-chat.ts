import { isSketchChat } from "@/lib/chat/sketch-chat"
import { workspaceChatId } from "@/lib/chat/workspace-chat"
import type { ChatSessionData, MarkdownLayerData } from "@/lib/types"

/**
 * Which chat a Document or Mockup goes to (#1724, spec #1723). Any chat may
 * change any of them with its tools, and each agent create or update records
 * the chat as the layer's `lastChangedByChatId`. While a chat's turn is
 * changing a layer, that chat holds it (#1725): no other chat may change it
 * until the turn ends. Quote in chat, Send to agent, the Knobs Ask,
 * Draw-and-ask, a live Mockup's borrowed Workspace and the Workspace grouping
 * all go to the holder, else the last changer. A layer from before then reads
 * the chat that made it (`ownerChatId`). A layer someone made by hand, or
 * whose chat was deleted, goes to none, and the caller falls back to the chat
 * the panel shows. React-free, tested against plain values.
 */

type Layer = Pick<
  MarkdownLayerData,
  "id" | "fileId" | "lastChangedByChatId" | "ownerChatId"
>

/** The chat that last changed a layer with its tools, if any did. */
export function lastChangedBy(
  layer: Pick<MarkdownLayerData, "lastChangedByChatId" | "ownerChatId">
): string | undefined {
  return layer.lastChangedByChatId ?? layer.ownerChatId
}

/** A chat on the canvas, as far as the rule reads it. */
type LayerChatSession = Pick<ChatSessionData, "id" | "branchId" | "target"> &
  Partial<
    Pick<ChatSessionData, "isStreaming" | "closedAt" | "workingLayers">
  > & {
    /** Picks the Workspace chat among several; a chat without it reads oldest. */
    createdAt?: number
  }

/**
 * The chat holding a layer (#1725): of the chats whose running turn is
 * changing it, the one that started on it first. A chat that isn't running
 * (its turn ended, or died and was healed) or was closed holds nothing,
 * whatever its list still says.
 */
export function layerHolder<C extends LayerChatSession>(
  layerId: string,
  chats: readonly C[]
): C | undefined {
  let holder: C | undefined
  let since = Infinity
  for (const chat of chats) {
    if (!chat.isStreaming || chat.closedAt) continue
    const started = chat.workingLayers?.[layerId]
    if (started === undefined || started >= since) continue
    holder = chat
    since = started
  }
  return holder
}

/**
 * {@link layerHolder} of every held layer at once, by layer id (#1726): what
 * the canvas labels and the sidebar rows show while a chat works on a layer.
 */
export function layerHolders<C extends LayerChatSession>(
  chats: readonly C[]
): Map<string, C> {
  const out = new Map<string, C>()
  const since = new Map<string, number>()
  for (const chat of chats) {
    if (!chat.isStreaming || chat.closedAt) continue
    for (const [layerId, started] of Object.entries(chat.workingLayers ?? {})) {
      if (started >= (since.get(layerId) ?? Infinity)) continue
      out.set(layerId, chat)
      since.set(layerId, started)
    }
  }
  return out
}

/**
 * The chat holding a view's file (#1883): the hold is the file's, keyed by
 * its id, and a view from before files is keyed by its own id, the same one.
 */
export function viewHolder<C extends LayerChatSession>(
  view: { id: string; fileId?: string },
  chats: readonly C[]
): C | undefined {
  const fileId = view.fileId ?? view.id
  return (
    layerHolder(fileId, chats) ??
    (fileId === view.id ? undefined : layerHolder(view.id, chats))
  )
}

/**
 * Whether `chatId` may change a layer: yes unless another chat holds it.
 * Returns the holder when it may not.
 */
export function heldByOther<C extends LayerChatSession>(
  layerId: string,
  chatId: string,
  chats: readonly C[]
): C | undefined {
  const holder = layerHolder(layerId, chats)
  return holder && holder.id !== chatId ? holder : undefined
}

/**
 * The chat messages from a layer go to, before the Workspace step of
 * {@link layerChat}: its holder, else the chat that last changed it.
 */
export function layerRoute(
  layer: Layer,
  chats: readonly LayerChatSession[]
): string | undefined {
  return viewHolder(layer, chats)?.id ?? lastChangedBy(layer)
}

/**
 * Where messages from a layer go: the Sketch Chat that last changed it, or
 * the Workspace chat of the chat that did (#1315), which is the same chat
 * unless an earlier, read-only chat of the Workspace changed it.
 */
export type LayerChat =
  | { kind: "sketch"; chatId: string }
  | { kind: "workspace"; chatId: string; branchId: string }

/**
 * The {@link LayerChat} of a layer last changed by `chatId`. Null for a layer
 * no chat changed, one whose chat was deleted, or one the Coordinator changed.
 */
export function layerChat(
  chatId: string | undefined,
  chats: readonly LayerChatSession[]
): LayerChat | null {
  const chat = chatId ? chats.find((c) => c.id === chatId) : undefined
  if (!chat) return null
  if (isSketchChat(chat)) return { kind: "sketch", chatId: chat.id }
  if (!chat.branchId) return null
  const workspaceChat =
    workspaceChatId(
      chats.map((c) => ({ ...c, createdAt: c.createdAt ?? 0 })),
      chat.branchId
    ) ?? chat.id
  return { kind: "workspace", chatId: workspaceChat, branchId: chat.branchId }
}

/** {@link layerChat} of each layer's {@link layerRoute}, by layer id. */
export function layerChats(
  layers: readonly Layer[],
  chats: readonly LayerChatSession[]
): Map<string, LayerChat> {
  const byChat = new Map<string, LayerChat | null>()
  const out = new Map<string, LayerChat>()
  for (const l of layers) {
    const chatId = layerRoute(l, chats)
    if (!chatId) continue
    if (!byChat.has(chatId)) byChat.set(chatId, layerChat(chatId, chats))
    const found = byChat.get(chatId)
    if (found) out.set(l.id, found)
  }
  return out
}

/**
 * The Workspace of each Document or Mockup a Workspace's chat holds or last
 * changed, by layer id: what the Group label names and where a live Mockup runs. A
 * layer no chat changed, a Sketch Chat's, or one whose chat is gone has none.
 */
export function layerWorkspaceIds(
  layers: readonly Layer[],
  chats: readonly LayerChatSession[]
): Map<string, string> {
  const out = new Map<string, string>()
  for (const [id, found] of layerChats(layers, chats)) {
    if (found.kind === "workspace") out.set(id, found.branchId)
  }
  return out
}
