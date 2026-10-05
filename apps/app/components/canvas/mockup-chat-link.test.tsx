// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { iframeBridgePort } from "@/lib/bridge-port"
import type { AskedQuestion } from "@/lib/canvas/mockup-chat-link"
import { useMockupPageChat } from "./mockup-chat-link"

const open: AskedQuestion = {
  toolCallId: "call-1",
  chatId: "chat-1",
  question: {
    question: "How should the row show each product?",
    options: [
      { label: "Show prices", detail: "With prices" },
      { label: "Names only" },
    ],
    recommended: 1,
    mockupId: "mock-1",
  },
}

function mount(found: AskedQuestion | null, answerable = true) {
  const frameWindow = { postMessage: vi.fn() }
  const iframeRef = {
    current: { contentWindow: frameWindow } as unknown as HTMLIFrameElement,
  }
  const port = iframeBridgePort(iframeRef)
  const onAnswer = vi.fn()
  const onDraft = vi.fn()
  const view = renderHook(
    (props: { found: AskedQuestion | null; answerable?: boolean }) =>
      useMockupPageChat(port, {
        question: props.found,
        answerable: props.answerable ?? answerable,
        onDraft,
        onAnswer,
      }),
    {
      initialProps: { found } as {
        found: AskedQuestion | null
        answerable?: boolean
      },
    }
  )
  const fromPage = (data: object) => {
    const event = new MessageEvent("message", { data })
    Object.defineProperty(event, "source", { value: frameWindow })
    window.dispatchEvent(event)
  }
  return { frameWindow, onAnswer, onDraft, view, fromPage }
}

describe("useMockupPageChat (#1644, #1645)", () => {
  it("hands the page its question when it asks, then every change", () => {
    const { frameWindow, view, fromPage } = mount(open)
    expect(frameWindow.postMessage).not.toHaveBeenCalled()

    fromPage({ type: "screenplay:question-request" })
    expect(frameWindow.postMessage).toHaveBeenLastCalledWith(
      {
        type: "screenplay:question-apply",
        question: {
          id: "call-1",
          question: "How should the row show each product?",
          options: [
            { label: "Show prices", detail: "With prices" },
            { label: "Names only" },
          ],
          recommended: 1,
          answer: null,
          answerable: true,
        },
      },
      "*"
    )

    // Answered on the card, or by a teammate: the page hears it.
    view.rerender({ found: { ...open, answer: { chosen: 0, by: "user_sam" } } })
    expect(frameWindow.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        question: expect.objectContaining({ answer: { index: 0 } }),
      }),
      "*"
    )
  })

  it("tells the page when a tap can't answer, and when that changes", () => {
    const { frameWindow, view, fromPage } = mount(open, false)
    fromPage({ type: "screenplay:question-request" })
    expect(frameWindow.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        question: expect.objectContaining({ answerable: false }),
      }),
      "*"
    )
    view.rerender({ found: open, answerable: true })
    expect(frameWindow.postMessage).toHaveBeenLastCalledWith(
      expect.objectContaining({
        question: expect.objectContaining({ answerable: true }),
      }),
      "*"
    )
  })

  it("passes on an answer to the open question", () => {
    const { onAnswer, fromPage } = mount(open)
    fromPage({ type: "screenplay:question-answer", id: "call-1", index: 1 })
    expect(onAnswer).toHaveBeenCalledWith(open, 1)
  })

  it("ignores an answer to another, an answered or a missing question", () => {
    const { onAnswer, view, fromPage } = mount(open)
    fromPage({ type: "screenplay:question-answer", id: "call-0", index: 1 })
    fromPage({ type: "screenplay:question-answer", id: "call-1", index: 5 })
    view.rerender({ found: { ...open, answer: { chosen: 0 } } })
    fromPage({ type: "screenplay:question-answer", id: "call-1", index: 1 })
    view.rerender({ found: null })
    fromPage({ type: "screenplay:question-answer", id: "call-1", index: 1 })
    expect(onAnswer).not.toHaveBeenCalled()
  })

  it("passes on a draft the page posts", () => {
    const { onDraft, fromPage } = mount(null)
    fromPage({ type: "screenplay:draft", text: "Picked B" })
    fromPage({ type: "screenplay:draft", text: 7 })
    expect(onDraft).toHaveBeenCalledTimes(1)
    expect(onDraft).toHaveBeenCalledWith("Picked B")
  })
})
