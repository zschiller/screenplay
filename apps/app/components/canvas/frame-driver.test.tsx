// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import { TooltipProvider } from "@workspace/ui/components/tooltip"
import { FrameDriverTag, FrameGoLiveToggle, FrameLiveTag } from "./frame-driver"

afterEach(cleanup)

function renderToggle(live: boolean, onToggle = vi.fn()) {
  render(
    <TooltipProvider>
      <FrameGoLiveToggle live={live} onToggle={onToggle} />
    </TooltipProvider>
  )
  return onToggle
}

describe("FrameGoLiveToggle", () => {
  it("offers Go live, unpressed, on your own copy", () => {
    const onToggle = renderToggle(false)
    const button = screen.getByRole("button", { name: "Go live" })
    expect(button.getAttribute("aria-pressed")).toBe("false")
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })

  it("is pressed while you're live, and a click leaves", () => {
    const onToggle = renderToggle(true)
    const button = screen.getByRole("button", { name: "Live" })
    expect(button.getAttribute("aria-pressed")).toBe("true")
    fireEvent.click(button)
    expect(onToggle).toHaveBeenCalledOnce()
  })
})

describe("the title-line tags", () => {
  it("says Live", () => {
    render(<FrameLiveTag />)
    expect(screen.getByText("Live")).toBeTruthy()
  })

  it("names who has control", () => {
    render(<FrameDriverTag driver={{ kind: "agent" }} />)
    expect(screen.getByText("Agent has control")).toBeTruthy()
  })
})
