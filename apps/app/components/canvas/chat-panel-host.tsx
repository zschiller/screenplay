"use client"

import {
  FolderPlusIcon,
  SidebarSimpleIcon,
} from "@workspace/ui/components/icons"
import { type PanelImperativeHandle } from "react-resizable-panels"

import { Button } from "@workspace/ui/components/button"
import { IconButton } from "@workspace/ui/components/icon-button"

import { ChatPanel } from "@/components/agent/chat-panel"
import { RoomChatPanel } from "@/components/agent/room-chat-panel"
import { WorkspacesMenuButton } from "@/components/agent/workspaces-menu"
import { roomChatId } from "@/lib/chat/room-chat"
import type { ChatSessionData, RepoData, TerminalTabData } from "@/lib/types"
import type { DiffStats } from "@/hooks/use-diff-stats"
import type { BranchPrInfo } from "@/lib/github-actions"

import type { ChatTarget } from "./use-chat-target"
import type { TabPool } from "./use-tab-pool"

/**
 * The right chat panel host (PRD #571) — consumes the resolved `ChatPanelTarget`
 * from the Chat-Target controller (#569) and renders the `ChatPanel`. With
 * nothing targeted it shows the panel's home, the Room's Coordinator chat
 * (#893), or the add-a-repository empty state on a canvas with no repositories.
 *
 * The target-resolution decision lives in the controller; this component only
 * derives the per-target view of the synced collections — the target's chat
 * sessions and (for an agent target) this client's local terminal tabs — and
 * wires the panel's verbs to the Chat-Target controller and the Tab Pool (#563).
 * Terminal tabs are passed as a separate collection (never merged into
 * `chatSessions`) so a terminal can't structurally reach the conversation model.
 */
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
  onLogsReady,
  logsRequest,
  onAddProject,
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
  onLogsReady: () => void
  logsRequest: { agentId: string; nonce: number } | null
  /** Open the sidebar's add-project flow, from the no-projects state. */
  onAddProject: () => void
}) {
  return (
    (() => {
      // The panel's current target is resolved by the Chat-Target
      // controller (#569): an agent (sandbox-backed) when one is selected
      // and ready, otherwise the doc-chat target when one was picked from
      // the dropdown. Falls through to the empty-state below when neither
      // is set.
      const target = chatTarget.target
      if (!target) {
        if (repos.length === 0) return null
        const chatId = roomChatId(roomId)
        return (
          <RoomChatPanel
            roomId={roomId}
            chatSession={chatSessions.find((c) => c.id === chatId)}
            onModelChange={(id, model) => onUpdateChatSession(id, { model })}
            onCollapse={() => chatPanelRef.current?.collapse()}
            onOpenWorkspace={({ branchId, chatId: taskChatId }) => {
              const chat = chatSessions.find(
                (c) =>
                  c.id === taskChatId && c.branchId === branchId && !c.closedAt
              )
              if (chat) {
                chatTarget.selectAgentChat(branchId, chat.id, {
                  clearDocument: true,
                  remember: true,
                })
              } else {
                chatTarget.selectAgent(branchId, { clearDocument: true })
              }
            }}
          />
        )
      }
      const filteredSessions = chatSessions.filter((c) => {
        if (target.kind === "agent") return c.branchId === target.agent.id
        // Layer targets: per-kind state lives on the chat session
        // under different fields.
        if (target.layerKind === "markdown-layer")
          return c.markdownLayerId === target.layer.id
        return false
      })
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
            if (target.kind === "agent")
              tabPool.open({ kind: "chat", branchId: target.agent.id })
            else if (target.layerKind === "markdown-layer")
              tabPool.open({
                kind: "doc-chat",
                markdownLayerId: target.layer.id,
              })
          }}
          onCreateTerminal={
            target.kind === "agent"
              ? (harnessKey) =>
                  tabPool.open({
                    kind: "terminal",
                    branchId: target.agent.id,
                    harnessKey,
                  })
              : undefined
          }
          onRenameChat={tabPool.rename}
          onRemoveChat={tabPool.remove}
          onCloseChat={tabPool.close}
          onReopenChat={tabPool.reopen}
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
          onLogsReady={onLogsReady}
          logsRequest={logsRequest}
        />
      )
    })() || (
      <div className="flex h-full flex-col bg-background">
        <div className="flex h-12 items-center bg-background px-3">
          <IconButton
            label="Collapse chat"
            shortcut="⌘I"
            tooltipSide="left"
            className="mr-1.5 text-muted-foreground"
            onClick={() => chatPanelRef.current?.collapse()}
          >
            <SidebarSimpleIcon mirrored />
          </IconButton>
          <span className="text-xs text-muted-foreground">No repositories</span>
          <div className="ml-auto flex items-center">
            <WorkspacesMenuButton />
          </div>
        </div>
        <div className="border-b border-border" />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6">
          <p className="max-w-xs text-center text-sm text-balance text-muted-foreground">
            Add a repository to get started
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddProject}
          >
            <FolderPlusIcon />
            Add repository
          </Button>
        </div>
      </div>
    )
  )
}
