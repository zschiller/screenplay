"use client"

import { useEffect, useMemo, useRef } from "react"
import { PanelRightClose } from "lucide-react"

import { IconButton } from "@workspace/ui/components/icon-button"

import { AgentChat } from "@/components/agent/agent-chat"
import { WorkspaceTasksProvider } from "@/components/agent/workspace-task-row"
import type { WorkspaceTaskRef } from "@/lib/agent/workspace-task"
import { useBranches, useChatSessions, usePlans } from "@/lib/yjs/react"
import { ROOM_CHAT_LABEL, roomChatId } from "@/lib/chat/room-chat"
import { ensureRoomChatAction } from "@/lib/room-chat-actions"
import type { ChatSessionData } from "@/lib/types"

/**
 * The chat panel's home (#893): the Room's one Coordinator chat, shown when no
 * Workspace or document is selected. One chat per canvas, so there is no tab
 * strip; the header is the collapse button and the chat's name.
 *
 * The chat's record is created on the server the first time any member's panel
 * shows it (its id is derived from the Room, so concurrent creates agree).
 */
export function RoomChatPanel({
  roomId,
  chatSession,
  onModelChange,
  onCollapse,
  onOpenWorkspace,
}: {
  roomId: string
  /** The Room's Coordinator chat record, or undefined until it's created. */
  chatSession: ChatSessionData | undefined
  onModelChange: (chatId: string, model: string) => void
  onCollapse: () => void
  /** Open a Workspace from its task row, on the chat the message went to. */
  onOpenWorkspace: (task: WorkspaceTaskRef) => void
}) {
  const chatId = roomChatId(roomId)

  // Task rows read the Room live, so they update in place as Workspaces work.
  const branches = useBranches()
  const chatSessions = useChatSessions()
  const plans = usePlans()
  const workspaceTasks = useMemo(
    () => ({ branches, chatSessions, plans, onOpen: onOpenWorkspace }),
    [branches, chatSessions, plans, onOpenWorkspace]
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
    <div className="flex h-full flex-col bg-background">
      <div className="flex h-12 items-center border-b border-border bg-background px-3">
        <IconButton
          label="Collapse chat"
          shortcut="⌘I"
          tooltipSide="left"
          asChild
        >
          <button
            className="mr-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
            onClick={onCollapse}
          >
            <PanelRightClose />
          </button>
        </IconButton>
        <h2 className="text-sm font-medium">{ROOM_CHAT_LABEL}</h2>
      </div>
      <div className="min-h-0 flex-1">
        <WorkspaceTasksProvider value={workspaceTasks}>
          <AgentChat
            chatId={chatId}
            roomId={roomId}
            roomTarget
            model={chatSession?.model}
            onModelChange={(model) => onModelChange(chatId, model)}
          />
        </WorkspaceTasksProvider>
      </div>
    </div>
  )
}
