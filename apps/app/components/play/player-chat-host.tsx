"use client"

import { memo, useCallback, useEffect, useRef, useState } from "react"
import { nanoid } from "nanoid"
import { SidebarSimpleIcon } from "@workspace/ui/components/icons"
import { IconButton } from "@workspace/ui/components/icon-button"
import { Spinner } from "@workspace/ui/components/spinner"
import { ChatPanel } from "@/components/agent/chat-panel"
import { chatStore } from "@/lib/chat-store"
import {
  useBranches,
  useChatSessions,
  useChatStreamEvents,
  useRoomCollections,
} from "@/lib/yjs/react"
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
 * Drives a `ChatPanel` for a single agent inside the prototype player.
 * Mirrors the canvas's chat plumbing — Yjs hooks for agents/sessions, the
 * `chatStore` for streaming, and the same handler set — but scoped to the
 * one agent the player is showing.
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
  const chatSessions = allChatSessions.filter((c) => c.branchId === agentId)
  const repo = agent ? collections.repos.toMap().get(agent.repoId) : undefined
  const diffStats = useDiffStats(agents, repo ? [repo] : [])
  const { branchPrs, setBranchPr } = useBranchPrs(agents, repo ? [repo] : [])

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)

  const updateChatSession = useCallback(
    (id: string, data: Partial<ChatSessionData>) => {
      collections.chatSessions.update(id, data)
    },
    [collections]
  )

  const addChatSession = useCallback(
    (id: string, data: ChatSessionData) => {
      collections.chatSessions.set(id, data)
    },
    [collections]
  )

  const removeChatSession = useCallback(
    (id: string) => {
      collections.chatSessions.delete(id)
    },
    [collections]
  )

  // Feed broadcast events into the chat store so the chat tabs stream
  // assistant output live, mirror streaming state into the session row.
  useChatStreamEvents((e) => {
    chatStore.handleBroadcastEvent(e)
    if (e.type === "chat-stream-start") {
      updateChatSession(e.chatId, { isStreaming: true })
    } else if (e.type === "chat-stream-end") {
      updateChatSession(e.chatId, { isStreaming: false })
    }
  })

  // Hydrate history for every chat so the panel can show past messages even
  // for chats the user hasn't opened on the canvas.
  useEffect(() => {
    for (const cs of chatSessions) {
      chatStore.loadHistory(cs.id)
    }
  }, [chatSessions])

  // Hydrate streaming state from Yjs on mount/reconnect — same pattern as
  // the canvas. The previous empty-deps form ran before Yjs initial sync
  // populated `chatSessions`, missing the streaming flag for slow
  // connections; now we hydrate exactly once when entries first arrive.
  const hydratedStreamingRef = useRef(false)
  useEffect(() => {
    if (hydratedStreamingRef.current || chatSessions.length === 0) return
    hydratedStreamingRef.current = true
    for (const cs of chatSessions) {
      if (cs.isStreaming) chatStore.setStreaming(cs.id, true)
    }
  }, [chatSessions])

  const handleCreateChat = useCallback(() => {
    if (!agent) return
    const id = nanoid()
    addChatSession(id, {
      id,
      branchId: agent.id,
      label: "Untitled",
      createdAt: Date.now(),
    })
    setSelectedChatId(id)
  }, [agent, addChatSession])

  const handleRenameChat = useCallback(
    (chatId: string, label: string) => {
      updateChatSession(chatId, { label })
    },
    [updateChatSession]
  )

  const handleCloseChat = useCallback(
    (chatId: string, nextSelectedId?: string) => {
      const chat = chatSessions.find((c) => c.id === chatId)
      const siblings = chat
        ? chatSessions
            .filter((c) => c.id !== chatId && !c.closedAt)
            .sort((a, b) => a.createdAt - b.createdAt)
        : []
      updateChatSession(chatId, { closedAt: Date.now() })
      if (chat && siblings.length === 0) {
        const newId = nanoid()
        addChatSession(newId, {
          id: newId,
          branchId: chat.branchId,
          label: "Untitled",
          createdAt: Date.now(),
        })
        setSelectedChatId(newId)
      } else if (selectedChatId === chatId) {
        setSelectedChatId(nextSelectedId ?? siblings[0]?.id ?? null)
      }
    },
    [selectedChatId, chatSessions, updateChatSession, addChatSession]
  )

  const handleReopenChat = useCallback(
    (chatId: string) => {
      updateChatSession(chatId, { closedAt: 0 })
    },
    [updateChatSession]
  )

  const handleRemoveChat = useCallback(
    (chatId: string) => {
      if (selectedChatId === chatId) {
        const chat = chatSessions.find((c) => c.id === chatId)
        const siblings = chat
          ? chatSessions
              .filter((c) => c.id !== chatId && !c.closedAt)
              .sort((a, b) => a.createdAt - b.createdAt)
          : []
        setSelectedChatId(siblings[0]?.id ?? null)
      }
      chatStore.cleanup(chatId)
      removeChatSession(chatId)
    },
    [selectedChatId, chatSessions, removeChatSession]
  )

  if (!agent) {
    return (
      <PlayerChatPlaceholder onCollapse={onCollapse}>
        Workspace not found.
      </PlayerChatPlaceholder>
    )
  }

  if (!agent.sandboxName) {
    return (
      <PlayerChatPlaceholder onCollapse={onCollapse}>
        <Spinner className="size-4" /> Waiting for the sandbox to start…
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
      onCreateChat={handleCreateChat}
      onRenameChat={handleRenameChat}
      onRemoveChat={handleRemoveChat}
      onCloseChat={handleCloseChat}
      onReopenChat={handleReopenChat}
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
 * The chat slot before there's a chat to show. Keeps the same 48px header row
 * and collapse button as `ChatPanel`, so the panel can always be closed and
 * doesn't jump when the chat mounts.
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
      <div className="flex h-12 shrink-0 items-center px-3">
        <IconButton
          label="Collapse chat"
          tooltipSide="left"
          // Same button as ChatPanel's collapse, so it sits in the same spot
          // when the chat mounts.
          className="text-muted-foreground"
          onClick={onCollapse}
        >
          <SidebarSimpleIcon mirrored />
        </IconButton>
      </div>
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
 * re-renders the tab strip and its `layout="position"` tabs re-measure and
 * trail the handle. The canvas host doesn't hit this — its zoom lib resizes the
 * stage imperatively, with no React state update. Requires `onCollapse` to be a
 * stable reference (the parent wraps it in `useCallback`).
 */
export const PlayerChatHost = memo(PlayerChatHostImpl)
