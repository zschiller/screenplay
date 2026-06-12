"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { nanoid } from "nanoid"
import { ChatPanel } from "@/components/agent/chat-panel"
import { renameAgentBranch } from "@/lib/sandbox/git"
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
}

/**
 * Drives a `ChatPanel` for a single agent inside the prototype player.
 * Mirrors the canvas's chat plumbing — Yjs hooks for agents/sessions, the
 * `chatStore` for streaming, and the same handler set — but scoped to the
 * one agent the player is showing.
 */
export function PlayerChatHost({
  roomId,
  agentId,
  onCollapse,
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

  const updateAgent = useCallback(
    (id: string, data: Partial<(typeof agents)[number]>) => {
      collections.branches.update(id, data)
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

  const handleBranchRename = useCallback(
    async (newBranchRaw: string) => {
      if (!agent || !repo) return
      const newBranch = newBranchRaw
        .toLowerCase()
        .replace(/[^a-z0-9/_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
      if (
        !newBranch ||
        !agent.sandboxName ||
        !agent.ref ||
        agent.ref === newBranch
      )
        return
      // Optimistic local rename — the sandbox roundtrip can take several
      // seconds and leaving the old name on screen feels broken. Roll back
      // if the sandbox rejects.
      const previousBranch = agent.ref
      updateAgent(agent.id, { ref: newBranch })
      const result = await renameAgentBranch(
        repo,
        agent.sandboxName,
        previousBranch,
        newBranch
      )
      if (!result.success) updateAgent(agent.id, { ref: previousBranch })
    },
    [agent, repo, updateAgent]
  )

  if (!agent) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-xs text-muted-foreground">Agent not found.</p>
      </div>
    )
  }

  if (!agent.sandboxName) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <p className="text-xs text-muted-foreground">
          Sandbox is still warming up…
        </p>
      </div>
    )
  }

  return (
    <ChatPanel
      target={{ kind: "agent", agent }}
      // The agent picker is built around switching between siblings; in the
      // player there's only one agent so we hand it a single-element list.
      agents={[agent]}
      markdownLayers={[]}
      onSelectAgent={() => {}}
      onSelectLayer={() => {}}
      disableBranchPicker
      chatSessions={chatSessions}
      selectedChatId={selectedChatId}
      roomId={roomId}
      onSelectChat={setSelectedChatId}
      onCreateChat={handleCreateChat}
      onRenameChat={handleRenameChat}
      onRemoveChat={handleRemoveChat}
      onCloseChat={handleCloseChat}
      onReopenChat={handleReopenChat}
      onBranchRename={handleBranchRename}
      onPlanModeChange={(chatId, planMode) =>
        updateChatSession(chatId, { planMode })
      }
      onModelChange={(chatId, model) => updateChatSession(chatId, { model })}
      diffStats={diffStats.get(agent.id)}
      branchPr={branchPrs.get(agent.id) ?? null}
      onPrCreated={setBranchPr}
      onCollapse={onCollapse}
    />
  )
}
