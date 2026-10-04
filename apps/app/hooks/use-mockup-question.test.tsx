// @vitest-environment jsdom
import { renderHook } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { iframeBridgePort } from "@/lib/bridge-port"
import type { MockupQuestion } from "@/lib/agent/question"
import { usePageQuestion } from "./use-mockup-question"

const open: MockupQuestion = {
  toolCallId: "call-1",
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

function mount(found: MockupQuestion | null) {
  const frameWindow = { postMessage: vi.fn() }
  const iframeRef = {
    current: { contentWindow: frameWindow } as unknown as HTMLIFrameElement,
  }
  const port = iframeBridgePort(iframeRef)
  const onAnswer = vi.fn()
  const view = renderHook(
    ({ found }: { found: MockupQuestion | null }) =>
      usePageQuestion(port, found, onAnswer),
    { initialProps: { found } }
  )
  const fromPage = (data: object) => {
    const event = new MessageEvent("message", { data })
    Object.defineProperty(event, "source", { value: frameWindow })
    window.dispatchEvent(event)
  }
  return { frameWindow, onAnswer, view, fromPage }
}

describe("usePageQuestion (#1644)", () => {
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
})
