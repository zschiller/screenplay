"use client"

import { useEffect, useMemo, useRef } from "react"
import { SidebarSimpleIcon } from "@workspace/ui/components/icons"

import { IconButton } from "@workspace/ui/components/icon-button"

import { AgentChat } from "@/components/agent/agent-chat"
import { WorkspaceTasksProvider } from "@/components/agent/workspace-task-row"
import { WorkspacesMenuButton } from "@/components/agent/workspaces-menu"
import type { WorkspaceTaskRef } from "@/lib/agent/workspace-task"
import { coordinatorStart } from "@/lib/fresh-workspace"
import {
  useBranches,
  useChatSessions,
  usePlans,
  useRepos,
} from "@/lib/yjs/react"
import { ROOM_CHAT_LABEL, roomChatId } from "@/lib/chat/room-chat"
import { ensureRoomChatAction } from "@/lib/room-chat-actions"
import type { ChatSessionData } from "@/lib/types"

/**
 * The chat panel's home (#893): the Room's one Coordinator chat, shown when no
 * Workspace or document is selected. One chat per canvas, so there is no tab
 * strip; the header is the collapse button, the chat's name and the Workspaces
 * button (#1152).
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
  const repos = useRepos()
  // A fresh canvas's empty chat asks what should change (#1182).
  const roomStart = useMemo(
    () => coordinatorStart({ repos, branches }),
    [repos, branches]
  )
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
      {/* `box-content` keeps the border outside the 48px row, so the title sits
          where the Workspace header's Coordinator crumb does and doesn't
          jump half a pixel when you switch between them. */}
      <div className="box-content flex h-12 items-center border-b border-border bg-background px-3">
        <IconButton
          label="Collapse chat"
          shortcut="⌘I"
          tooltipSide="left"
          className="mr-1.5 text-muted-foreground"
          onClick={onCollapse}
        >
          <SidebarSimpleIcon mirrored />
        </IconButton>
        <h2 className="text-sm font-medium">{ROOM_CHAT_LABEL}</h2>
        <div className="ml-auto flex items-center">
          <WorkspacesMenuButton />
        </div>
      </div>
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
    </div>
  )
}
