// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { FrameStatus } from "./frame-status"

afterEach(cleanup)

describe("FrameStatus on an unanswered frame (#1358)", () => {
  it("offers Start a chat, the one control that takes the pointer", () => {
    const onStartChat = vi.fn()
    const { container } = render(
      <FrameStatus stage="unassigned" onStartChat={onStartChat} />
    )
    const button = screen.getByRole("button", { name: "Start a chat" })
    expect(container.firstElementChild?.className).toContain(
      "pointer-events-none"
    )
    expect(button.parentElement?.className).toContain("pointer-events-auto")
    fireEvent.click(button)
    expect(onStartChat).toHaveBeenCalledOnce()
  })

  it("has no Start a chat without a way to start one", () => {
    render(<FrameStatus stage="unassigned" />)
    expect(screen.queryByRole("button", { name: "Start a chat" })).toBeNull()
  })

  it("only offers it while the frame has no Workspace", () => {
    render(<FrameStatus stage="booting" onStartChat={vi.fn()} />)
    expect(screen.queryByRole("button", { name: "Start a chat" })).toBeNull()
  })
})
