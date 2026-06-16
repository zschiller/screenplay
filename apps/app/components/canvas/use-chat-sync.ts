import { useEffect, useRef } from "react"

import { withBasePath } from "@/lib/base-path"
import { chatStore } from "@/lib/chat-store"
import { useChatStreamEvents } from "@/lib/yjs/react"
import type { ChatSessionData } from "@/lib/types"

/**
 * Chat Sync controller (PRD #588) — the single home for the Canvas's
 * chat-store ↔ Y.Doc synchronization effects, lifted out of the composition
 * root where they sat among the rest of the orphan sync effects. Three effects
 * share this one owner because they all reconcile the client chat-store against
 * the room's synced chat state:
 *
 *  1. **History load** — load past messages for every Chat Session so other
 *     clients can see history for chats they haven't opened yet. Terminal Tabs
 *     can't reach this loop by construction — they're a distinct type in
 *     `localTerminals`, never in `chatSessions` — so terminal scrollback never
 *     enters the chat-store.
 *  2. **Streaming-heal hydration** — the first time `chatSessions` has entries,
 *     mirror each storage-`streaming` chat into the client store and ask the
 *     heal endpoint to verify the underlying run is still live (unsticking a
 *     spinner whose `chat-stream-end` was missed on a slow connection). Lived in
 *     Sandbox Reconnect before; it is chat-store hydration, not Sandbox
 *     lifecycle, so it homes here with its siblings.
 *  3. **Broadcast handling** — feed server-broadcast chat events (from the room
 *     Y.Doc, via `useChatStreamEvents`) into the chat-store, and mirror the
 *     streaming / rename signals into the Chat Session so late joiners see them.
 *
 * It is the **React effects, not a new write path**: storage writes go through
 * the injected `updateChatSession` (a thin Canvas Operation wrapper, ADR 0001),
 * and the chat-store calls are the existing `chatStore` API.
 */
export interface ChatSyncDeps {
  /** Live Chat Sessions from the synced Y.Doc — history + heal read these. */
  chatSessions: ChatSessionData[]
  /** Room id, threaded into the heal POST body. */
  roomId: string
  /** Canvas Operation wrapper that patches a Chat Session record (ADR 0001). */
  updateChatSession: (id: string, patch: Partial<ChatSessionData>) => void
}

export function useChatSync({
  chatSessions,
  roomId,
  updateChatSession,
}: ChatSyncDeps): void {
  // Load history for all chat sessions so other clients can see past messages
  // for chats they haven't opened yet.
  useEffect(() => {
    for (const cs of chatSessions) {
      chatStore.loadHistory(cs.id)
    }
  }, [chatSessions])

  // Hydrate chatStore streaming state from Yjs storage on mount/reconnect. For
  // each chat that's marked streaming in storage, ask the server to verify the
  // underlying agent run is still actually active. If it's ended, the heal
  // endpoint broadcasts chat-stream-end to unstick the spinner. The previous
  // empty-deps form ran before Yjs initial sync completed, so for slow
  // connections the streaming flag from storage was missed; now we hydrate the
  // first time `chatSessions` actually has entries, then never again.
  const hydratedStreamingRef = useRef(false)
  useEffect(() => {
    if (hydratedStreamingRef.current || chatSessions.length === 0) return
    hydratedStreamingRef.current = true
    for (const cs of chatSessions) {
      if (!cs.isStreaming) continue
      chatStore.setStreaming(cs.id, true)
      fetch(withBasePath("/api/branch/heal"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId, chatId: cs.id }),
      }).catch((e) => console.error("Heal request failed:", e))
    }
  }, [chatSessions, roomId])

  // Receive server-broadcast chat events via the room Y.Doc and feed into the
  // chat store.
  useChatStreamEvents((e) => {
    chatStore.handleBroadcastEvent(e)
    // Mirror streaming state into the chat session so late joiners see it.
    if (e.type === "chat-stream-start") {
      updateChatSession(e.chatId, { isStreaming: true })
    } else if (e.type === "chat-stream-end") {
      updateChatSession(e.chatId, { isStreaming: false })
    } else if (e.type === "chat-control" && e.control.kind === "chat_rename") {
      // Apply the auto-generated label here, at the canvas level, rather than
      // relying on the per-chat `onChatRename` callback: that callback is an
      // inline arrow re-registered on every AgentChat render, so a rename
      // broadcast landing during the clear/re-set window would be dropped.
      // Writing the Y.Doc here is independent of which chat tab is mounted.
      updateChatSession(e.chatId, { label: e.control.label })
    }
  })
}
