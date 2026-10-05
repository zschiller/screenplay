"use client"

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react"
import type { AgentMessage } from "@/lib/agent/types"
import { chatStore, type ChatState } from "@/lib/chat-store"
import type { OutgoingTurnParts } from "@/lib/agent/outgoing-turn"
import type { ChatTarget } from "@/lib/chat/chat-target"

interface UseAgentChatOptions {
  chatId: string
  roomId: string
  /** What the chat talks to. */
  target: ChatTarget
  isFirstChat?: boolean
  planMode?: boolean
  /** Whether the chat is on screen. Defaults to true. */
  isActive?: boolean
}

interface SendOptions {
  model?: string
  /** `false` sends outside plan mode whatever the toggle says. */
  planMode?: false
  /** The composer document, kept so a failed or queued send can be edited. */
  draft?: unknown
}

export function useAgentChat({
  chatId,
  roomId,
  target,
  isFirstChat,
  planMode,
  isActive = true,
}: UseAgentChatOptions) {
  // Callers build the target inline, a fresh object each render. Key it on
  // what it names so `sendMessage` keeps its identity.
  const targetKey = JSON.stringify(target)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableTarget = useMemo(() => target, [targetKey])

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
    (message: string | OutgoingTurnParts, options?: SendOptions) => {
      return chatStore.sendMessage({
        roomId,
        chatId,
        target: stableTarget,
        // Plain text, or the Composer's parts with the chat's own added.
        ...(typeof message === "string" ? { message } : message),
        isFirstChat,
        planMode: options?.planMode ?? planMode,
        model: options?.model,
        draft: options?.draft,
      })
    },
    [chatId, roomId, stableTarget, isFirstChat, planMode]
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
