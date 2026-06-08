// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import type { AgentMessage } from "@/lib/agent/types"
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
