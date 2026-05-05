"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"
import { chatStore, type ChatState } from "@/lib/chat-store"

interface UseAgentChatOptions {
  chatId: string
  roomId: string
  sandboxName: string
  branch: string
  isFirstChat?: boolean
  autoNamedBranch?: boolean
  planMode?: boolean
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
  isFirstChat,
  autoNamedBranch,
  planMode,
  onBranchRename,
  onChatRename,
}: UseAgentChatOptions) {
  const state: ChatState = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.getSnapshot(chatId),
    () => chatStore.getSnapshot(chatId),
  )

  // Load history once per chatId. Keyed by chatId since the agent's message
  // log is stored under that key in Postgres.
  useEffect(() => {
    chatStore.loadHistory(chatId)
  }, [chatId])

  // Register callbacks so broadcast events can trigger Liveblocks mutations
  useEffect(() => {
    chatStore.setCallbacks(chatId, { onBranchRename, onChatRename })
    return () => chatStore.clearCallbacks(chatId)
  }, [chatId, onBranchRename, onChatRename])

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
        planMode,
        model: options?.model,
        onBranchRename,
        onChatRename,
      })
    },
    [
      chatId,
      roomId,
      sandboxName,
      branch,
      isFirstChat,
      autoNamedBranch,
      planMode,
      onBranchRename,
      onChatRename,
    ],
  )

  const stopMessage = useCallback(() => {
    chatStore.stopMessage(roomId, chatId)
  }, [roomId, chatId])

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    isLoadingHistory: state.isLoadingHistory,
    error: state.error,
    sendMessage,
    stopMessage,
  }
}
