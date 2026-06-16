import { useCallback, useMemo } from "react"

import type { CanvasOps } from "@/lib/canvas/ops"
import type { ChatSessionData } from "@/lib/types"

/**
 * Chat Session Writes controller (PRD #588) — the single small owner of the
 * three thin **Canvas Operation** wrappers for Chat Session identity:
 * `addChatSession`, `updateChatSession`, and `removeChatSession`. These used to
 * sit as root-level `useCallback` pass-throughs that the composition root only
 * defined to thread straight back into Tab Pool, Branch Intake, Branch Actions,
 * and Element Reference; now those consumers read them from this one owner.
 *
 * Like the rest of the canvas decomposition it is the **React binding, not a new
 * write path**: every write routes through the Canvas Operation seam (`ops`, ADR
 * 0001), never the Y.Doc directly. The single field write goes through
 * `ops.patch`; add / remove call the meaning-bearing `ops` verbs.
 */
export interface ChatSessionWrites {
  addChatSession: (id: string, data: ChatSessionData) => void
  updateChatSession: (id: string, patch: Partial<ChatSessionData>) => void
  removeChatSession: (id: string) => void
}

export function useChatSessionWrites(ops: CanvasOps): ChatSessionWrites {
  const addChatSession = useCallback(
    (id: string, data: ChatSessionData) => {
      ops.addChatSession(id, data)
    },
    [ops]
  )

  const updateChatSession = useCallback(
    (id: string, data: Partial<ChatSessionData>) => {
      ops.patch("chatSessions", id, data)
    },
    [ops]
  )

  const removeChatSession = useCallback(
    (id: string) => {
      ops.removeChatSession(id)
    },
    [ops]
  )

  return useMemo(
    () => ({ addChatSession, updateChatSession, removeChatSession }),
    [addChatSession, updateChatSession, removeChatSession]
  )
}
