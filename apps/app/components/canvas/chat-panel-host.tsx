"use client"

import { FolderPlusIcon } from "@workspace/ui/components/icons"
import { type PanelImperativeHandle } from "react-resizable-panels"

import { Button } from "@workspace/ui/components/button"

import { AddRepositoryTrigger } from "@/components/add-repository-dialog"
import { ChatPanel } from "@/components/agent/chat-panel"
import type { DevServerControls } from "@/components/agent/terminal-pane"
import { ChatPanelHeader } from "@/components/agent/chat-panel-header"
import { ChatsMenuButton } from "@/components/agent/chats-menu"
import type { ChatPanelTarget } from "@/lib/chat/chat-target"
import { roomChatId } from "@/lib/chat/room-chat"
import type { ChatSessionData, RepoData, TerminalTabData } from "@/lib/types"
import type { DiffStats } from "@/hooks/use-diff-stats"
import type { BranchPrInfo } from "@/lib/github-actions"

import type { ChatTarget } from "./use-chat-target"
import type { TabPool } from "./use-tab-pool"

/**
 * The right chat panel host (PRD #571) — consumes the resolved `ChatPanelTarget`
 * from the Chat-Target controller (#569) and renders the `ChatPanel`. With
 * nothing targeted it shows the panel's home, `ChatPanel` with the Room target
 * (the Coordinator chat, #893), or the add-a-repository empty state on a canvas
 * with no repositories.
 *
 * The target-resolution decision lives in the controller; this component only
 * derives the per-target view of the synced collections — the target's chat
 * sessions and (for an agent target) this client's local terminal tabs — and
 * wires the panel's verbs to the Chat-Target controller and the Tab Pool (#563).
 * Terminal tabs are passed as a separate collection (never merged into
 * `chatSessions`) so a terminal can't structurally reach the conversation model.
 */
const ROOM_TARGET: ChatPanelTarget = { kind: "room" }

export function ChatPanelHost({
  chatTarget,
  tabPool,
  chatSessions,
  localTerminals,
  repos,
  roomId,
  diffStats,
  branchPrs,
  chatPanelRef,
  onUpdateChatSession,
  onSetBranchPr,
  logsRequest,
  devServerControls,
}: {
  chatTarget: ChatTarget
  tabPool: TabPool
  chatSessions: ChatSessionData[]
  /** This client's local terminal tabs, kept apart from `chatSessions`. */
  localTerminals: TerminalTabData[]
  repos: RepoData[]
  roomId: string
  diffStats: Map<string, DiffStats>
  branchPrs: Map<string, BranchPrInfo>
  chatPanelRef: React.RefObject<PanelImperativeHandle | null>
  onUpdateChatSession: (id: string, data: Partial<ChatSessionData>) => void
  onSetBranchPr: (branchId: string, pr: BranchPrInfo) => void
  logsRequest: { agentId: string; nonce: number } | null
  devServerControls: DevServerControls
}) {
  return (
    (() => {
      // The panel's current target is resolved by the Chat-Target
      // controller (#569): an agent (sandbox-backed) when one is selected
      // and ready. Otherwise it is the Room (the Coordinator), or, on a
      // canvas with no repositories, the empty state below.
      const target: ChatPanelTarget | null =
        chatTarget.target ?? (repos.length > 0 ? ROOM_TARGET : null)
      if (!target) return null
      const filteredSessions = chatSessions.filter((c) =>
        target.kind === "room"
          ? c.id === roomChatId(roomId)
          : c.branchId === target.agent.id
      )
      // This client's local terminal tabs for an agent target. Passed as a
      // separate collection (never merged into `chatSessions`), so a
      // terminal can't structurally reach the conversation model.
      const terminalTabs =
        target.kind === "agent"
          ? localTerminals.filter((t) => t.branchId === target.agent.id)
          : []
      return (
        <ChatPanel
          target={target}
          chatSessions={filteredSessions}
          terminalTabs={terminalTabs}
          selectedChatId={chatTarget.selectedChatId}
          roomId={roomId}
          onSelectChat={chatTarget.selectChat}
          onShowRoomChat={chatTarget.showRoomChat}
          onCreateChat={() => {
            // The Room has one chat, and no "+" to make another.
            if (target.kind === "agent")
              tabPool.open({ kind: "chat", branchId: target.agent.id })
          }}
          onCreateTerminal={
            target.kind === "agent"
              ? () =>
                  tabPool.open({ kind: "terminal", branchId: target.agent.id })
              : undefined
          }
          onRenameTerminal={tabPool.rename}
          onCloseTerminal={tabPool.close}
          onRemoveChat={tabPool.remove}
          onPlanModeChange={(chatId, pm) =>
            onUpdateChatSession(chatId, { planMode: pm })
          }
          onModelChange={(chatId, model) =>
            onUpdateChatSession(chatId, { model })
          }
          diffStats={
            target.kind === "agent" ? diffStats.get(target.agent.id) : undefined
          }
          branchPr={
            target.kind === "agent"
              ? (branchPrs.get(target.agent.id) ?? null)
              : null
          }
          onPrCreated={onSetBranchPr}
          onCollapse={() => chatPanelRef.current?.collapse()}
          onOpenWorkspace={({ branchId, chatId: taskChatId }) => {
            const chat = chatSessions.find(
              (c) =>
                c.id === taskChatId && c.branchId === branchId && !c.closedAt
            )
            if (chat) {
              chatTarget.selectAgentChat(branchId, chat.id, {
                remember: true,
              })
            } else {
              chatTarget.selectAgent(branchId)
            }
          }}
          logsRequest={logsRequest}
          devServerControls={devServerControls}
        />
      )
    })() || (
      <div className="flex h-full flex-col bg-background">
        <ChatPanelHeader onCollapse={() => chatPanelRef.current?.collapse()}>
          <span className="text-xs text-muted-foreground">No repositories</span>
          <div className="ml-auto flex items-center">
            <ChatsMenuButton />
          </div>
        </ChatPanelHeader>
        <div className="border-b border-border" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <p className="max-w-xs text-center text-sm text-balance text-muted-foreground">
            Add a repository to get started
          </p>
          <AddRepositoryTrigger align="center">
            <Button type="button" variant="outline" size="sm">
              <FolderPlusIcon />
              Add repository
            </Button>
          </AddRepositoryTrigger>
        </div>
      </div>
    )
  )
}
