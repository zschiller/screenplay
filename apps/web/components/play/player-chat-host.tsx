"use client"

import { useCallback, useEffect, useState } from "react"
import { nanoid } from "nanoid"
import { ChatPanel } from "@/components/agent/chat-panel"
import { renameAgentBranch } from "@/lib/sandbox-actions"
import { chatStore } from "@/lib/chat-store"
import {
  useAgents,
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
  const agents = useAgents()
  const allChatSessions = useChatSessions()
  const agent = agents.find((a) => a.id === agentId)
  const chatSessions = allChatSessions.filter((c) => c.agentId === agentId)
  const workspace = agent
    ? collections.workspaces.toMap().get(agent.workspaceId)
    : undefined
  const diffStats = useDiffStats(agents, workspace ? [workspace] : [])
  const branchPrs = useBranchPrs(agents, workspace ? [workspace] : [])

  const [selectedChatId, setSelectedChatId] = useState<string | null>(null)

  const updateChatSession = useCallback(
    (id: string, data: Partial<ChatSessionData>) => {
      collections.chatSessions.update(id, data)
    },
    [collections],
  )

  const addChatSession = useCallback(
    (id: string, data: ChatSessionData) => {
      collections.chatSessions.set(id, data)
    },
    [collections],
  )

  const removeChatSession = useCallback(
    (id: string) => {
      collections.chatSessions.delete(id)
    },
    [collections],
  )

  const updateAgent = useCallback(
    (id: string, data: Partial<typeof agents[number]>) => {
      collections.agents.update(id, data)
    },
    [collections],
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

  // Hydrate history for any chats that already have a sessionId so the panel
  // can show past messages even if the user never opened them on the canvas.
  useEffect(() => {
    for (const cs of chatSessions) {
      if (cs.sessionId) chatStore.loadHistory(cs.id, cs.sessionId)
    }
  }, [chatSessions])

  // Hydrate streaming state from Yjs on mount/reconnect — same pattern as
  // the canvas. Empty deps: only on mount.
  useEffect(() => {
    for (const cs of chatSessions) {
      if (cs.isStreaming) chatStore.setStreaming(cs.id, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleCreateChat = useCallback(() => {
    if (!agent) return
    const id = nanoid()
    addChatSession(id, {
      id,
      agentId: agent.id,
      label: "Untitled",
      createdAt: Date.now(),
    })
    setSelectedChatId(id)
  }, [agent, addChatSession])

  const handleRenameChat = useCallback(
    (chatId: string, label: string) => {
      updateChatSession(chatId, { label })
    },
    [updateChatSession],
  )

  const handleCloseChat = useCallback(
    (chatId: string) => {
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
          agentId: chat.agentId,
          label: "Untitled",
          createdAt: Date.now(),
        })
        setSelectedChatId(newId)
      } else if (selectedChatId === chatId) {
        setSelectedChatId(siblings[0]?.id ?? null)
      }
    },
    [selectedChatId, chatSessions, updateChatSession, addChatSession],
  )

  const handleReopenChat = useCallback(
    (chatId: string) => {
      updateChatSession(chatId, { closedAt: 0 })
    },
    [updateChatSession],
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
    [selectedChatId, chatSessions, removeChatSession],
  )

  const handleBranchRename = useCallback(
    async (newBranchRaw: string) => {
      if (!agent || !workspace) return
      const newBranch = newBranchRaw
        .toLowerCase()
        .replace(/[^a-z0-9/_-]/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
      if (
        !newBranch ||
        !agent.sandboxName ||
        !agent.branch ||
        agent.branch === newBranch
      )
        return
      const result = await renameAgentBranch(
        workspace,
        agent.sandboxName,
        agent.branch,
        newBranch,
      )
      if (result.success) updateAgent(agent.id, { branch: newBranch })
    },
    [agent, workspace, updateAgent],
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
      agent={agent}
      // The agent picker is built around switching between siblings; in the
      // player there's only one agent so we hand it a single-element list.
      agents={[agent]}
      onSelectAgent={() => {}}
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
      onSessionId={(chatId, sid) =>
        updateChatSession(chatId, { sessionId: sid || undefined })
      }
      onBranchRename={handleBranchRename}
      onPlanModeChange={(chatId, planMode) =>
        updateChatSession(chatId, { planMode })
      }
      onModelChange={(chatId, model) =>
        updateChatSession(chatId, { model })
      }
      diffStats={diffStats.get(agent.id)}
      branchPr={branchPrs.get(agent.id) ?? null}
      onCollapse={onCollapse}
    />
  )
}
