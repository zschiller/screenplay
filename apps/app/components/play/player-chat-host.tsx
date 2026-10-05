"use client"

import { memo, useCallback, useMemo, useState } from "react"
import { Spinner } from "@workspace/ui/components/spinner"
import { ChatPanel } from "@/components/agent/chat-panel"
import { ChatPanelHeader } from "@/components/agent/chat-panel-header"
import {
  useBranches,
  useChatSessions,
  useRoomCollections,
} from "@/lib/yjs/react"
import { useChatTabs } from "@/hooks/use-chat-tabs"
import { useDiffStats } from "@/hooks/use-diff-stats"
import { useBranchPrs } from "@/hooks/use-branch-prs"
import type { ChatSessionData } from "@/lib/types"

interface PlayerChatHostProps {
  roomId: string
  agentId: string
  /** Hides the panel and lets the parent fold the panel slot. */
  onCollapse: () => void
  /** A frame's "Open logs", forwarded to the panel (see `ChatPanel`). */
  logsRequest?: { agentId: string; nonce: number } | null
}

/**
 * Drives a `ChatPanel` for a single agent inside the prototype player: finds
 * the agent, then shows the placeholder or the panel. Chat tabs and Chat Sync
 * come from `useChatTabs`, the same module the Canvas uses, scoped to the one
 * Branch the player is showing.
 */
function PlayerChatHostImpl({
  roomId,
  agentId,
  onCollapse,
  logsRequest,
}: PlayerChatHostProps) {
  const collections = useRoomCollections()
  const agents = useBranches()
  const allChatSessions = useChatSessions()
  const agent = agents.find((a) => a.id === agentId)
  const chatSessions = useMemo(
    () => allChatSessions.filter((c) => c.branchId === agentId),
    [allChatSessions, agentId]
  )
  const repo = agent ? collections.repos.toMap().get(agent.repoId) : undefined
  const diffStats = useDiffStats(agents, repo ? [repo] : [])
  const { branchPrs, setBranchPr } = useBranchPrs(agents, repo ? [repo] : [])

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)

  const addChatSession = useCallback(
    (id: string, data: ChatSessionData) => {
      collections.chatSessions.set(id, data)
    },
    [collections]
  )

  const updateChatSession = useCallback(
    (id: string, data: Partial<ChatSessionData>) => {
      collections.chatSessions.update(id, data)
    },
    [collections]
  )

  const removeChatSession = useCallback(
    (id: string) => {
      collections.chatSessions.delete(id)
    },
    [collections]
  )

  // The Canvas's chat tabs and Chat Sync, scoped to this one Branch (#1261):
  // close / remove / respawn follow the Tab Pool rule, and a stream whose end
  // was missed heals instead of spinning.
  const chatTabs = useChatTabs({
    roomId,
    chatSessions,
    addChatSession,
    updateChatSession,
    removeChatSession,
    selectedChatId,
    selectChat: setSelectedChatId,
  })

  if (!agent) {
    return (
      <PlayerChatPlaceholder onCollapse={onCollapse}>
        Chat not found.
      </PlayerChatPlaceholder>
    )
  }

  if (!agent.sandboxName) {
    return (
      <PlayerChatPlaceholder onCollapse={onCollapse}>
        <Spinner className="size-4" /> Still setting up the code…
      </PlayerChatPlaceholder>
    )
  }

  return (
    <ChatPanel
      target={{ kind: "agent", agent }}
      chatSessions={chatSessions}
      selectedChatId={selectedChatId}
      roomId={roomId}
      onSelectChat={setSelectedChatId}
      onCreateChat={() => chatTabs.open({ kind: "agent", branchId: agent.id })}
      onPlanModeChange={(chatId, planMode) =>
        updateChatSession(chatId, { planMode })
      }
      onModelChange={(chatId, model) => updateChatSession(chatId, { model })}
      diffStats={diffStats.get(agent.id)}
      branchPr={branchPrs.get(agent.id) ?? null}
      onPrCreated={setBranchPr}
      onCollapse={onCollapse}
      logsRequest={logsRequest}
    />
  )
}

/**
 * The chat slot before there's a chat to show. Draws `ChatPanel`'s header row,
 * so the panel can always be closed and doesn't jump when the chat mounts.
 */
function PlayerChatPlaceholder({
  onCollapse,
  children,
}: {
  onCollapse: () => void
  children: React.ReactNode
}) {
  return (
    <div className="flex h-full flex-col bg-background">
      <ChatPanelHeader onCollapse={onCollapse} />
      {/* Same type and copy as AgentChat's provisioning state, so the panel
       *  reads the same whether the chat has mounted yet or not. pb-12 offsets
       *  the header so the message sits at the panel's true centre. */}
      <div className="flex flex-1 items-center justify-center gap-2 px-6 pb-12 text-center text-sm text-balance text-muted-foreground">
        {children}
      </div>
    </div>
  )
}

/**
 * Memoized so the prototype player's per-frame `stageSize` re-renders don't
 * reach the chat subtree. `PrototypePlayer` runs a ResizeObserver on the preview
 * stage that `setStageSize`s on every resize frame; while dragging the chat
 * panel's handle the stage shrinks each frame, so without this every frame
 * re-renders the whole chat subtree with it. The canvas host doesn't hit this — its zoom lib resizes the
 * stage imperatively, with no React state update. Requires `onCollapse` to be a
 * stable reference (the parent wraps it in `useCallback`).
 */
export const PlayerChatHost = memo(PlayerChatHostImpl)
