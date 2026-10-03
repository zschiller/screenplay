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
})

describe("the title-line tags", () => {
  it("says Live", () => {
    render(<FrameLiveTag />)
    expect(screen.getByText("Live")).toBeTruthy()
  })

  it("shows a face per person on the live frame, in their cursor colour", () => {
    const { container } = render(
      <FrameLiveTag
        faces={[
          { kind: "person", id: "zack", name: "Zack", color: "#FF8FC8" },
          { kind: "person", id: "ana", name: "Ana", color: "#7FD4FF" },
          { kind: "agent" },
        ]}
      />
    )
    const faces = [...container.querySelectorAll("[data-live-face]")]
    expect(faces.map((f) => f.getAttribute("data-live-face"))).toEqual([
      "zack",
      "ana",
      "agent",
    ])
    expect(faces[0]?.textContent).toBe("Z")
    expect(
      (faces[1]?.querySelector("[data-slot=avatar-fallback]") as HTMLElement)
        .style.backgroundColor
    ).toBe("rgb(127, 212, 255)")
    expect(screen.getByText("with Zack, Ana, Agent")).toBeTruthy()
  })

  it("counts the faces past four", () => {
    const people = ["a", "b", "c", "d", "e", "f"].map((id) => ({
      kind: "person" as const,
      id,
      name: id,
      color: "#FFB74D",
    }))
    const { container } = render(<FrameLiveTag faces={people} />)
    expect(container.querySelectorAll("[data-live-face]")).toHaveLength(4)
    expect(screen.getByText("+2")).toBeTruthy()
  })

  it("names who has control", () => {
    render(<FrameDriverTag driver={{ kind: "agent" }} />)
    expect(screen.getByText("Agent has control")).toBeTruthy()
  })
})
