"use client"

import { PanelRightClose } from "lucide-react"
import { type PanelImperativeHandle } from "react-resizable-panels"

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@workspace/ui/components/tooltip"
import { Kbd } from "@workspace/ui/components/kbd"

import { ChatPanel } from "@/components/agent/chat-panel"
import type {
  BranchData,
  ChatSessionData,
  MarkdownLayerData,
  RepoData,
  TerminalTabData,
} from "@/lib/types"
import type { DiffStats } from "@/hooks/use-diff-stats"
import type { BranchPrInfo } from "@/lib/github-actions"

import type { ChatTarget } from "./use-chat-target"
import type { TabPool } from "./use-tab-pool"

/**
 * The right chat panel host (PRD #571) — consumes the resolved `ChatPanelTarget`
 * from the Chat-Target controller (#569) and renders the `ChatPanel`, or the
 * empty state when nothing is targeted.
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
  agents,
  markdownLayers,
  chatSessions,
  localTerminals,
  repos,
  roomId,
  diffStats,
  branchPrs,
  chatPanelRef,
  onRenameBranch,
  onUpdateChatSession,
  onSetBranchPr,
  onLogsReady,
}: {
  chatTarget: ChatTarget
  tabPool: TabPool
  agents: BranchData[]
  markdownLayers: MarkdownLayerData[]
  chatSessions: ChatSessionData[]
  /** This client's local terminal tabs, kept apart from `chatSessions`. */
  localTerminals: TerminalTabData[]
  repos: RepoData[]
  roomId: string
  diffStats: Map<string, DiffStats>
  branchPrs: Map<string, BranchPrInfo>
  chatPanelRef: React.RefObject<PanelImperativeHandle | null>
  onRenameBranch: (id: string, branch: string) => void
  onUpdateChatSession: (id: string, data: Partial<ChatSessionData>) => void
  onSetBranchPr: (branchId: string, pr: BranchPrInfo) => void
  onLogsReady: () => void
}) {
  return (
    (() => {
      // The panel's current target is resolved by the Chat-Target
      // controller (#569): an agent (sandbox-backed) when one is selected
      // and ready, otherwise the doc-chat target when one was picked from
      // the dropdown. Falls through to the empty-state below when neither
      // is set.
      const target = chatTarget.target
      if (!target) return null
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
          agents={agents}
          markdownLayers={markdownLayers}
          onSelectAgent={(id) =>
            chatTarget.selectAgent(id, { clearDocument: true })
          }
          onSelectLayer={(layerKind, id) => {
            if (layerKind === "markdown-layer") {
              chatTarget.selectDocument(id)
              return
            }
          }}
          chatSessions={filteredSessions}
          terminalTabs={terminalTabs}
          selectedChatId={chatTarget.selectedChatId}
          roomId={roomId}
          onSelectChat={chatTarget.selectChat}
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
          onBranchRename={(branch) => {
            if (target.kind === "agent") onRenameBranch(target.agent.id, branch)
          }}
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
        />
      )
    })() || (
      <div className="flex h-full flex-col bg-background">
        <div className="flex h-12 items-center bg-background px-3">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="mr-1.5 flex aspect-square w-5 items-center justify-center rounded-md p-0 text-muted-foreground hover:bg-accent hover:text-accent-foreground [&>svg]:size-4 [&>svg]:shrink-0"
                  onClick={() => chatPanelRef.current?.collapse()}
                >
                  <PanelRightClose className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left">
                Collapse chat <Kbd>⌘I</Kbd>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span className="text-xs text-muted-foreground">
            {repos.length === 0 ? "No workspaces" : "No active agents"}
          </span>
        </div>
        <div className="border-b border-border" />
        <div className="flex flex-1 items-center justify-center px-6">
          <p className="text-sm text-muted-foreground">
            {repos.length === 0
              ? "Add a workspace to get started"
              : "Waiting for an agent to start…"}
          </p>
        </div>
      </div>
    )
  )
}
