// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { AgentMessage } from "@/lib/agent/types"
import { MARKED_DONE_RESULT } from "@/lib/agent/done-result"
import { ChatDoneProvider, MarkedDoneCard } from "./marked-done-card"

function call(
  overrides: Partial<AgentMessage & { role: "tool_call" }> = {},
  result = MARKED_DONE_RESULT
): AgentMessage & { role: "tool_call" } {
  return {
    role: "tool_call",
    toolCallId: "t1",
    title: "mcp__screenplay__mark_done",
    status: "completed",
    rawInput: { reason: "#482 merged and nothing is waiting on you." },
    content: [{ type: "content", content: { type: "text", text: result } }],
    ...overrides,
  }
}

function renderCard(
  message = call(),
  chat: { done: boolean; onReopen?: () => void } | null = { done: true }
) {
  const card = (
    <MarkedDoneCard
      message={message}
      fallback={<div data-testid="fallback">row</div>}
    />
  )
  return render(
    chat ? <ChatDoneProvider value={chat}>{card}</ChatDoneProvider> : card
  )
}

afterEach(cleanup)

describe("MarkedDoneCard (#1705)", () => {
  it("shows Marked done with the agent’s reason, and Reopen reopens the chat", () => {
    const onReopen = vi.fn()
    renderCard(call(), { done: true, onReopen })

    expect(screen.getByText("Marked done")).toBeTruthy()
    expect(
      screen.getByText("#482 merged and nothing is waiting on you.")
    ).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }))
    expect(onReopen).toHaveBeenCalledOnce()
  })

  it("drops Reopen once the chat is open again", () => {
    renderCard(call(), { done: false, onReopen: vi.fn() })
    expect(screen.getByText("Marked done")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "Reopen" })).toBeNull()
  })

  it("is the plain row while it runs, and when it refused", () => {
    renderCard(call({ status: "in_progress", content: [] }))
    expect(screen.getByTestId("fallback")).toBeTruthy()
    cleanup()
    renderCard(call({}, "Not marked done: pull request #482 is still open."))
    expect(screen.getByTestId("fallback")).toBeTruthy()
    expect(screen.queryByText("Marked done")).toBeNull()
  })
})
