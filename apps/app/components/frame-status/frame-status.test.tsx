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

describe("FrameStatus dropping what doesn't fit", () => {
  // jsdom has no layout: give each part its UI size.
  const SIZES: Record<string, [number, number]> = {
    "frame-status-block": [320, 140],
    "empty-description": [320, 40],
    "empty-content": [140, 28],
    "empty-title": [160, 24],
    "empty-icon": [32, 32],
  }
  const size = (el: HTMLElement, i: 0 | 1) =>
    SIZES[el.dataset.slot ?? ""]?.[i] ?? 0
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(
    function (this: HTMLElement) {
      return size(this, 0)
    }
  )
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return size(this, 1)
    }
  )

  const shown = (zoom: number) => {
    const { container } = render(
      <FrameStatus
        stage="stopped"
        onStart={vi.fn()}
        zoom={zoom}
        frameWidth={1440}
        frameHeight={900}
      />
    )
    return ["empty-icon", "empty-title", "empty-description", "empty-content"]
      .filter((slot) => {
        const el = container.querySelector<HTMLElement>(`[data-slot=${slot}]`)
        return el && !el.hidden && !el.closest<HTMLElement>("[style*=hidden]")
      })
      .map((slot) => slot.replace("empty-", ""))
  }

  // The parts carry the hiding themselves, not a rule keyed on the block's
  // tier, which the desktop app's WebKit didn't restyle as the zoom changed.
  it("hides the parts on the parts as the frame shrinks on screen", () => {
    expect(shown(1)).toEqual(["icon", "title", "description", "content"])
    expect(shown(0.2)).toEqual(["icon", "title", "content"])
    expect(shown(0.15)).toEqual(["icon", "title"])
    expect(shown(0.1)).toEqual(["icon"])
    expect(shown(0.02)).toEqual([])
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
