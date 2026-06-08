// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { AgentMessage } from "@/lib/agent/types"
import type { ToolCallContent } from "@/lib/agent/acp/schema"
import { AgentMessageItem } from "./agent-message"

afterEach(cleanup)

describe("AgentMessageItem — reasoning (ACP agent_thought_chunk)", () => {
  const reasoning: AgentMessage = {
    role: "reasoning",
    content: "First I weigh the options.",
  }

  it("renders reasoning in a collapsible slot, collapsed by default", () => {
    render(<AgentMessageItem message={reasoning} />)

    // The collapsible affordance is present (getByRole throws if it isn't)...
    expect(screen.getByRole("button", { name: /reasoning/i })).toBeTruthy()
    // ...but the thinking text is hidden until expanded.
    expect(screen.queryByText("First I weigh the options.")).toBeNull()
  })

  it("reveals the reasoning text when the slot is expanded", () => {
    render(<AgentMessageItem message={reasoning} />)

    fireEvent.click(screen.getByRole("button", { name: /reasoning/i }))

    expect(screen.getByText("First I weigh the options.")).toBeTruthy()
  })
})

function toolCall(
  partial: Partial<Extract<AgentMessage, { role: "tool_call" }>>
): AgentMessage {
  return {
    role: "tool_call",
    toolCallId: "call_1",
    title: "edit_file",
    kind: "edit",
    status: "pending",
    content: [],
    ...partial,
  }
}

describe("AgentMessageItem — ACP tool call (issue #377)", () => {
  it("shows a spinner while pending and in_progress, for any tool", () => {
    const { rerender } = render(
      <AgentMessageItem message={toolCall({ status: "pending" })} />
    )
    expect(screen.getByTestId("tool-call-spinner")).toBeTruthy()
    expect(screen.getByTestId("tool-call").getAttribute("data-status")).toBe(
      "pending"
    )

    rerender(<AgentMessageItem message={toolCall({ status: "in_progress" })} />)
    expect(screen.getByTestId("tool-call-spinner")).toBeTruthy()
  })

  it("drops the spinner once completed and flags a failure", () => {
    const { rerender } = render(
      <AgentMessageItem message={toolCall({ status: "completed" })} />
    )
    expect(screen.queryByTestId("tool-call-spinner")).toBeNull()
    expect(screen.getByTestId("tool-call").getAttribute("data-status")).toBe(
      "completed"
    )

    rerender(<AgentMessageItem message={toolCall({ status: "failed" })} />)
    expect(screen.queryByTestId("tool-call-spinner")).toBeNull()
    expect(screen.getByTestId("tool-call").getAttribute("data-status")).toBe(
      "failed"
    )
  })

  it("renders a diff content block structurally (path + old/new), not flattened", () => {
    const diff: ToolCallContent = {
      type: "diff",
      path: "src/a.ts",
      oldText: "before",
      newText: "after",
    }
    render(
      <AgentMessageItem
        message={toolCall({ status: "completed", content: [diff] })}
      />
    )
    // Expand to reveal the structured content.
    fireEvent.click(screen.getByTestId("tool-call"))
    const diffEl = screen.getByTestId("tool-content-diff")
    expect(diffEl.textContent).toContain("src/a.ts")
    expect(diffEl.textContent).toContain("before")
    expect(diffEl.textContent).toContain("after")
  })

  it("renders a terminal content block as its own structural element", () => {
    const terminal: ToolCallContent = { type: "terminal", terminalId: "t_42" }
    render(
      <AgentMessageItem
        message={toolCall({
          title: "run_command",
          kind: "execute",
          status: "completed",
          content: [terminal],
        })}
      />
    )
    fireEvent.click(screen.getByTestId("tool-call"))
    expect(screen.getByTestId("tool-content-terminal").textContent).toContain(
      "t_42"
    )
  })
})
