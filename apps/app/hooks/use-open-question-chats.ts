"use client"

import { useCallback, useMemo, useSyncExternalStore } from "react"
import { hasOpenQuestion } from "@/lib/agent/question"
import type { AgentMessage } from "@/lib/agent/types"
import { chatStore } from "@/lib/chat-store"
import type { ChatSessionData } from "@/lib/types"

// A transcript's messages keep their reference until the chat changes, so each
// is scanned once however many callers ask.
const openCache = new WeakMap<readonly AgentMessage[], boolean>()

function isOpen(messages: readonly AgentMessage[]): boolean {
  let open = openCache.get(messages)
  if (open === undefined)
    openCache.set(messages, (open = hasOpenQuestion(messages)))
  return open
}

const NONE: ReadonlySet<string> = new Set()

/**
 * The open chats, by id, whose transcript ends on a question card nobody has
 * answered. Transcripts live in the chat store, which loads every chat's
 * history (`useChatSync`), not in the Room doc, so this is where Workspace
 * State learns that a chat waits on a question (`roomWorkspaceFacts`). The
 * set keeps its reference until the answer changes.
 */
export function useOpenQuestionChats(
  chats: readonly Pick<ChatSessionData, "id" | "closedAt">[]
): ReadonlySet<string> {
  const ids = chats.filter((c) => !c.closedAt).map((c) => c.id)
  const key = ids.join(",")
  const subscribe = useCallback(
    (cb: () => void) => {
      const unsubs = ids.map((id) => chatStore.subscribe(id, cb))
      return () => unsubs.forEach((u) => u())
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
  // A string, so an unchanged answer is an unchanged snapshot.
  const getSnapshot = useCallback(
    () =>
      ids.filter((id) => isOpen(chatStore.getSnapshot(id).messages)).join(","),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key]
  )
  const open = useSyncExternalStore(subscribe, getSnapshot, () => "")
  return useMemo(() => (open ? new Set(open.split(",")) : NONE), [open])
}
