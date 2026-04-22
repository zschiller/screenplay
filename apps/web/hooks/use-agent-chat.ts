"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"
import { chatStore, type ChatState } from "@/lib/chat-store"

interface UseAgentChatOptions {
  chatId: string
  roomId: string
  sandboxName: string
  branch: string
  sessionId?: string
  isFirstChat?: boolean
  autoNamedBranch?: boolean
  planMode?: boolean
  onSessionId?: (sessionId: string) => void
  onBranchRename?: (branch: string) => void
  onChatRename?: (label: string) => void
}

interface SendOptions {
  model?: string
}

export function useAgentChat({
  chatId,
  roomId,
  sandboxName,
  branch,
  sessionId,
  isFirstChat,
  autoNamedBranch,
  planMode,
  onSessionId,
  onBranchRename,
  onChatRename,
}: UseAgentChatOptions) {
  const state: ChatState = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.getSnapshot(chatId),
    () => chatStore.getSnapshot(chatId),
  )

  // Load history once if session exists
  useEffect(() => {
    if (sessionId) {
      chatStore.loadHistory(chatId, sessionId)
    }
  }, [chatId, sessionId])

  // Register callbacks so broadcast events can trigger Liveblocks mutations
  useEffect(() => {
    chatStore.setCallbacks(chatId, { onSessionId, onBranchRename, onChatRename })
    return () => chatStore.clearCallbacks(chatId)
  }, [chatId, onSessionId, onBranchRename, onChatRename])

  // Mark as read when streaming finishes while this chat is open
  useEffect(() => {
    if (!state.isStreaming) {
      chatStore.markRead(chatId)
    }
  }, [chatId, state.isStreaming])

  const sendMessage = useCallback(
    (text: string, options?: SendOptions) => {
      chatStore.sendMessage({
        roomId,
        chatId,
        sandboxName,
        branch,
        message: text,
        isFirstChat,
        autoNamedBranch,
        sessionId,
        planMode,
        model: options?.model,
        onSessionId,
        onBranchRename,
        onChatRename,
      })
    },
    [chatId, roomId, sandboxName, branch, isFirstChat, autoNamedBranch, sessionId, planMode, onSessionId, onBranchRename, onChatRename],
  )

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    isLoadingHistory: state.isLoadingHistory,
    error: state.error,
    sendMessage,
  }
}
