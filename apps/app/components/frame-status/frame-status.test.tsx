// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { FrameStatus } from "./frame-status"
import { statusTier, type StatusParts } from "./status-fit"

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

describe("FrameStatus on the canvas (I17)", () => {
  const block = (zoom: number, frameWidth = 1440, frameHeight = 900) => {
    const { container } = render(
      <FrameStatus
        stage="booting"
        zoom={zoom}
        frameWidth={frameWidth}
        frameHeight={frameHeight}
      />
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.style.transform).toBe("")
    return root.querySelector<HTMLElement>("[data-slot=frame-status-block]")!
  }

  it("counter-scales the block, not the frame's background, zoomed out", () => {
    expect(block(0.25).style.transform).toBe("scale(4)")
  })

  it("keeps its UI size zoomed in too", () => {
    expect(block(2).style.transform).toBe("scale(0.5)")
  })

  it("is 1:1 at 100% and without a frame size", () => {
    expect(block(1).style.transform).toBe("")
    expect(block(0.5, 0, 0).style.transform).toBe("")
  })
})

describe("statusTier", () => {
  // A block 320 × 180: 40 of description, 40 of buttons, a 32px icon.
  const parts: StatusParts = {
    width: 320,
    height: 180,
    description: 40,
    actions: 40,
    bareWidth: 160,
    icon: 32,
  }

  it("shows the whole block with 24px clear to the edges", () => {
    expect(statusTier(parts, 368, 228)).toBe("full")
    expect(statusTier(parts, 367, 228)).not.toBe("full")
  })

  it("drops the description, then the buttons, then the title", () => {
    expect(statusTier(parts, 300, 188)).toBe("no-description")
    expect(statusTier(parts, 300, 148)).toBe("title")
    expect(statusTier(parts, 200, 100)).toBe("icon")
    expect(statusTier(parts, 40, 40)).toBe("none")
  })

  it("never shrinks: a narrow frame drops parts instead", () => {
    expect(statusTier(parts, 200, 2000)).toBe("icon")
  })
})
