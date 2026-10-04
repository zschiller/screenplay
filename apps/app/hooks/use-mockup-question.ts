"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react"
import type { BridgePort } from "@/lib/bridge-port"
import {
  mockupQuestion,
  toPageQuestion,
  type MockupQuestion,
} from "@/lib/agent/question"
import type { AgentMessage } from "@/lib/agent/types"
import { chatStore } from "@/lib/chat-store"

const NO_MESSAGES: AgentMessage[] = []

/**
 * The latest question the chat that made a Mockup asked about it (#1644),
 * answered or not, from that chat's transcript in the chat store (which loads
 * every chat's history with the canvas). Null when there's none, or the chat
 * is gone.
 */
export function useMockupQuestion(
  mockupId: string,
  chatId: string | undefined
): MockupQuestion | null {
  const subscribe = useCallback(
    (cb: () => void) => (chatId ? chatStore.subscribe(chatId, cb) : () => {}),
    [chatId]
  )
  const messages = useSyncExternalStore(
    subscribe,
    () => (chatId ? chatStore.getSnapshot(chatId).messages : NO_MESSAGES),
    () => NO_MESSAGES
  )
  return useMemo(() => mockupQuestion(messages, mockupId), [messages, mockupId])
}

/**
 * Hands a Mockup page its question (`screenplay.question()`): on the page's
 * request and on every change. An answer the page sends (`screenplay.answer`)
 * goes to `onAnswer` only while the question it names is still the open one.
 */
export function usePageQuestion(
  port: BridgePort,
  found: MockupQuestion | null,
  onAnswer: ((found: MockupQuestion, index: number) => void) | undefined
): void {
  const pageQuestion = useMemo(
    () => (found ? toPageQuestion(found) : null),
    [found]
  )
  const foundRef = useRef(found)
  const pageQuestionRef = useRef(pageQuestion)
  const onAnswerRef = useRef(onAnswer)
  useEffect(() => {
    foundRef.current = found
    pageQuestionRef.current = pageQuestion
    onAnswerRef.current = onAnswer
  })

  // Every change after the first, which the page asks for once it loads.
  const sent = useRef<string | null>(null)
  useEffect(() => {
    const serialized = JSON.stringify(pageQuestion)
    if (sent.current === null || sent.current === serialized) return
    sent.current = serialized
    port.post({ type: "screenplay:question-apply", question: pageQuestion })
  }, [pageQuestion, port])

  useEffect(() => {
    return port.subscribe((data) => {
      if (data.type === "screenplay:question-request") {
        sent.current = JSON.stringify(pageQuestionRef.current)
        port.post({
          type: "screenplay:question-apply",
          question: pageQuestionRef.current,
        })
      } else if (data.type === "screenplay:question-answer") {
        const open = foundRef.current
        if (!open || open.answer || open.toolCallId !== data.id) return
        if (
          !Number.isInteger(data.index) ||
          data.index < 0 ||
          data.index >= open.question.options.length
        ) {
          return
        }
        onAnswerRef.current?.(open, data.index)
      }
    })
  }, [port])
}
