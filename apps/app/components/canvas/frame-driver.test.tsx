// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { FrameDriverTag, FrameGoLiveToggle, FrameLiveTag } from "./frame-driver"

afterEach(cleanup)

function renderToggle(live: boolean, onToggle = vi.fn(), pending = false) {
  render(
    <TooltipProvider>
      <FrameGoLiveToggle live={live} pending={pending} onToggle={onToggle} />
    </TooltipProvider>
  )
  return onToggle
}

describe("FrameGoLiveToggle", () => {
  it("offers Go live, unpressed, on own copies", () => {
    const onToggle = renderToggle(false)
    const button = screen.getByRole("button", { name: "Go live" })
    expect(button.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it("is pressed while the frame is live, and a click ends it", () => {
    const onToggle = renderToggle(true)
    const button = screen.getByRole("button", { name: "Live" })
    expect(button.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it("spins in place of its icon while going live, ignoring clicks", () => {
    const onToggle = renderToggle(true, vi.fn(), true)
    const button = screen.getByRole("button", { name: "Going live" })
    expect(button.getAttribute("aria-busy")).toBe("true")
    expect(button.querySelector(".ph-circle-notch")).toBeTruthy()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onToggle).not.toHaveBeenCalled()
  })
})

describe("the title-line tags", () => {
  it("says Live, with the broadcast icon and no faces", () => {
    const { container } = render(<FrameLiveTag />)
    expect(screen.getByText("Live")).toBeTruthy()
    expect(container.querySelector(".ph-broadcast")).toBeTruthy()
    expect(container.querySelector("[data-slot=avatar]")).toBeNull()
  })

  it("names who has control", () => {
    render(<FrameDriverTag driver={{ kind: "agent" }} />)
    expect(screen.getByText("Agent has control")).toBeTruthy()
  })
})
