"use client"

import { useEffect, useMemo, useRef } from "react"
import { AgentChat } from "@/components/agent/agent-chat"
import { WorkspaceTasksProvider } from "@/components/agent/workspace-task-row"
import { useOpenQuestionChats } from "@/hooks/use-open-question-chats"
import type { WorkspaceTaskRef } from "@/lib/agent/workspace-task"
import { coordinatorStart } from "@/lib/fresh-workspace"
import {
  useBranches,
  useChatSessions,
  usePlans,
  useRepos,
} from "@/lib/yjs/react"
import { roomChatId } from "@/lib/chat/room-chat"
import { viewRequests } from "@/lib/canvas/view-requests"
import { ensureRoomChatAction } from "@/lib/room-chat-actions"
import type { ChatSessionData } from "@/lib/types"

/**
 * The body of the chat panel's home (#893): the Room's one Coordinator chat,
 * shown when no Workspace or document is selected. `ChatPanel` draws it under
 * its shared header for the Room target; one chat per canvas, so there is no
 * tab strip.
 *
 * The chat's record is created on the server the first time any member's panel
 * shows it (its id is derived from the Room, so concurrent creates agree).
 */
export function CoordinatorChat({
  roomId,
  chatSession,
  onModelChange,
  onOpenWorkspace,
}: {
  roomId: string
  /** The Room's Coordinator chat record, or undefined until it's created. */
  chatSession: ChatSessionData | undefined
  onModelChange: (chatId: string, model: string) => void
  /** Open a Workspace from its task row, on the chat the message went to. */
  onOpenWorkspace: (task: WorkspaceTaskRef) => void
}) {
  const chatId = roomChatId(roomId)

  // Task rows read the Room live, so they update in place as Workspaces work.
  const branches = useBranches()
  const chatSessions = useChatSessions()
  const plans = usePlans()
  const openQuestions = useOpenQuestionChats(chatSessions)
  const repos = useRepos()
  // A fresh canvas's empty chat asks what should change (#1182).
  const roomStart = useMemo(
    () => coordinatorStart({ repos, branches }),
    [repos, branches]
  )
  const workspaceTasks = useMemo(
    () => ({
      branches,
      chatSessions,
      plans,
      openQuestions,
      onOpen: onOpenWorkspace,
      // A frame, document or mockup a reply names: fit it in this member's
      // view, as the Coordinator's own `show_on_canvas` does.
      onShow: (layerId: string) =>
        viewRequests.emit({ chatId, ids: [layerId] }),
    }),
    [branches, chatSessions, plans, openQuestions, onOpenWorkspace, chatId]
  )

  const requestedRef = useRef(false)
  useEffect(() => {
    if (chatSession || requestedRef.current) return
    requestedRef.current = true
    ensureRoomChatAction(roomId).catch((e) => {
      requestedRef.current = false
      console.error("Couldn't create the Coordinator chat:", e)
    })
  }, [chatSession, roomId])

  return (
    <div className="min-h-0 flex-1">
      <WorkspaceTasksProvider value={workspaceTasks}>
        <AgentChat
          chatId={chatId}
          roomId={roomId}
          target={{ kind: "room" }}
          roomStart={roomStart}
          model={chatSession?.model}
          onModelChange={(model) => onModelChange(chatId, model)}
        />
      </WorkspaceTasksProvider>
    </div>
  )
}
