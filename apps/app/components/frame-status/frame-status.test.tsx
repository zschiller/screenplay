// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

import { FrameStatus, statusScale } from "./frame-status"

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

describe("FrameStatus zoomed out (I17)", () => {
  it("counter-scales into the frame's on-screen box", () => {
    const { container } = render(
      <FrameStatus
        stage="booting"
        zoom={0.25}
        frameWidth={1440}
        frameHeight={900}
      />
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.style.transform).toBe("scale(2.5)")
    expect(root.style.width).toBe("40%")
  })

  it("scales with the canvas at 100% and closer", () => {
    const { container } = render(
      <FrameStatus
        stage="booting"
        zoom={2}
        frameWidth={1440}
        frameHeight={900}
      />
    )
    const root = container.firstElementChild as HTMLElement
    expect(root.style.transform).toBe("")
  })
})

describe("statusScale", () => {
  it("is 1/zoom while the frame has room", () => {
    expect(statusScale(0.5, 1440, 1080)).toBe(2)
  })

  it("is capped by the frame's size", () => {
    expect(statusScale(0.1, 1440, 900)).toBe(2.5)
    expect(statusScale(0.1, 960, 2000)).toBe(2)
  })

  it("never shrinks the block", () => {
    expect(statusScale(1.5, 1440, 900)).toBe(1)
    expect(statusScale(0.5, 480, 320)).toBe(1)
  })
})
