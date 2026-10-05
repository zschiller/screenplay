"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react"
import type { BridgePort } from "@/lib/bridge-port"
import { toPageQuestion } from "@/lib/agent/question"
import type {
  AskedQuestion,
  MockupChatLink,
} from "@/lib/canvas/mockup-chat-link"

/**
 * The canvas's {@link MockupChatLink}, for every Mockup on it (#1662). Null
 * outside a canvas: the page then speaks to no chat.
 */
const MockupChatLinkContext = createContext<MockupChatLink | null>(null)

export const MockupChatLinkProvider = MockupChatLinkContext.Provider

export function useMockupChatLink(): MockupChatLink | null {
  return useContext(MockupChatLinkContext)
}

/**
 * The latest question any chat asked about a Mockup (#1644), answered or not.
 * Null when there's none, or outside a canvas.
 */
export function useMockupQuestion(
  link: MockupChatLink | null,
  mockupId: string
): AskedQuestion | null {
  const subscribe = useCallback(
    (cb: () => void) => (link ? link.watchQuestions(cb) : () => {}),
    [link]
  )
  return useSyncExternalStore(
    subscribe,
    () => link?.question(mockupId) ?? null,
    () => null
  )
}

export interface MockupPageChat {
  /** The question the page offers (`screenplay.question()`). */
  question: AskedQuestion | null
  /**
   * The page drafted a message (`screenplay.draft`, #1645). Unset while this
   * viewer's tap doesn't speak (see `tapSpeaks`).
   */
  onDraft?: (text: string) => void
  /**
   * The page answered the open question (`screenplay.answer`, #1644). Unset
   * while this viewer's tap doesn't speak.
   */
  onAnswer?: (found: AskedQuestion, index: number) => void
}

/**
 * Everything a Mockup page says to its chat, over the page's bridge: a draft,
 * a request for its question, an answer. Hands the page its question on
 * request and on every change; passes an answer on only while the question it
 * names is still the open one.
 */
export function useMockupPageChat(
  port: BridgePort,
  { question, onDraft, onAnswer }: MockupPageChat
): void {
  const pageQuestion = useMemo(
    () => (question ? toPageQuestion(question) : null),
    [question]
  )
  const latest = useRef({ question, pageQuestion, onDraft, onAnswer })
  useEffect(() => {
    latest.current = { question, pageQuestion, onDraft, onAnswer }
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
      const now = latest.current
      if (data.type === "screenplay:draft") {
        if (typeof data.text === "string") now.onDraft?.(data.text)
      } else if (data.type === "screenplay:question-request") {
        sent.current = JSON.stringify(now.pageQuestion)
        port.post({
          type: "screenplay:question-apply",
          question: now.pageQuestion,
        })
      } else if (data.type === "screenplay:question-answer") {
        const open = now.question
        if (!open || open.answer || open.toolCallId !== data.id) return
        if (
          !Number.isInteger(data.index) ||
          data.index < 0 ||
          data.index >= open.question.options.length
        ) {
          return
        }
        now.onAnswer?.(open, data.index)
      }
    })
  }, [port])
}
