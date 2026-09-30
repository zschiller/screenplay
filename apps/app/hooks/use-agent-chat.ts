"use client"

import { useCallback, useEffect, useSyncExternalStore } from "react"
import type { AgentMessage } from "@/lib/agent/types"
import { chatStore, type ChatState } from "@/lib/chat-store"

interface UseAgentChatOptions {
  chatId: string
  roomId: string
  /** Sandbox-backed target. Mutually exclusive with `markdownLayerId`. */
  sandboxName?: string
  /** Document-layer target. Mutually exclusive with `sandboxName`. */
  markdownLayerId?: string
  /** The Room's Coordinator chat. Mutually exclusive with the other targets. */
  roomTarget?: boolean
  isFirstChat?: boolean
  planMode?: boolean
  /** Whether the chat is on screen. Defaults to true. */
  isActive?: boolean
}

interface SendOptions {
  model?: string
  /** The composer document, kept so a failed or queued send can be edited. */
  draft?: unknown
}

export function useAgentChat({
  chatId,
  roomId,
  sandboxName,
  markdownLayerId,
  roomTarget,
  isFirstChat,
  planMode,
  isActive = true,
}: UseAgentChatOptions) {
  const state: ChatState = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.getSnapshot(chatId),
    () => chatStore.getSnapshot(chatId)
  )

  // Load history once per chatId. Keyed by chatId since the agent's message
  // log is stored under that key in Postgres.
  useEffect(() => {
    chatStore.loadHistory(chatId)
  }, [chatId])

  // Mark as read when a run finishes while this chat is on screen, or when a
  // chat with an unread run comes on screen. Every open tab stays mounted, so
  // gating on `isActive` is what lets a background tab keep its unread dot.
  const hasUnread = useSyncExternalStore(
    (cb) => chatStore.subscribe(chatId, cb),
    () => chatStore.hasUnread(chatId),
    () => false
  )
  useEffect(() => {
    if (isActive && hasUnread && !state.isStreaming) {
      chatStore.markRead(chatId)
    }
  }, [chatId, isActive, hasUnread, state.isStreaming])

  const sendMessage = useCallback(
    (text: string, options?: SendOptions) => {
      return chatStore.sendMessage({
        roomId,
        chatId,
        sandboxName,
        markdownLayerId,
        roomTarget,
        message: text,
        isFirstChat,
        planMode,
        model: options?.model,
        draft: options?.draft,
      })
    },
    [
      chatId,
      roomId,
      sandboxName,
      markdownLayerId,
      roomTarget,
      isFirstChat,
      planMode,
    ]
  )

  const stopMessage = useCallback(() => {
    chatStore.stopMessage(roomId, chatId)
  }, [roomId, chatId])

  const retryFailedSend = useCallback(
    () => chatStore.retryFailedSend(chatId),
    [chatId]
  )
  const takeFailedSend = useCallback(
    () => chatStore.takeFailedSend(chatId),
    [chatId]
  )
  const takeQueued = useCallback(
    (id: string) => chatStore.takeQueued(chatId, id),
    [chatId]
  )
  const takeReturnedSteers = useCallback(
    () => chatStore.takeReturnedSteers(chatId),
    [chatId]
  )
  const retryHistory = useCallback(
    () => chatStore.loadHistory(chatId),
    [chatId]
  )
  const retryError = useCallback(
    (message: AgentMessage) => chatStore.retryError(chatId, message),
    [chatId]
  )

  return {
    messages: state.messages,
    isStreaming: state.isStreaming,
    runStart: state.runStart,
    isLoadingHistory: state.isLoadingHistory,
    historyFailed: state.historyFailed,
    error: state.error,
    failedSend: state.failedSend,
    queued: state.queued,
    pendingSteers: state.pendingSteers,
    // A chat steers only once its running turn said it can (#1250).
    steerable: state.steerable === true,
    returnedSteers: state.returnedSteers,
    sendMessage,
    stopMessage,
    retryFailedSend,
    takeFailedSend,
    takeQueued,
    takeReturnedSteers,
    retryHistory,
    retryError,
  }
}
