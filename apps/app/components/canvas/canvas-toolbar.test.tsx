// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react"
import { IconButton } from "@workspace/ui/components/icon-button"

import { CanvasToolbar } from "./canvas-toolbar"
import { useToolMode } from "./use-tool-mode"

vi.mock("@/lib/local-mode", () => ({ isLocalBuild: false }))

// Radix's floating content measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

afterEach(cleanup)

describe("IconButton", () => {
  it("requires a label at the type level", () => {
    // @ts-expect-error — `label` is required
    const el = <IconButton>x</IconButton>
    expect(el).toBeTruthy()
  })

  it("uses the label as the accessible name and exposes pressed state", () => {
    render(
      <IconButton label="Frame" shortcut="F" pressed>
        <svg />
      </IconButton>
    )
    const button = screen.getByRole("button", { name: "Frame" })
    expect(button.getAttribute("aria-pressed")).toBe("true")
  })

  it("omits aria-pressed for plain action buttons", () => {
    render(<IconButton label="Reload">↻</IconButton>)
    const button = screen.getByRole("button", { name: "Reload" })
    expect(button.hasAttribute("aria-pressed")).toBe(false)
  })

  it("shows the label and shortcut in a styled tooltip on focus", async () => {
    render(
      <IconButton label="Select" shortcut="V">
        <svg />
      </IconButton>
    )
    await act(async () => {
      fireEvent.focus(screen.getByRole("button", { name: "Select" }))
    })
    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip.textContent).toContain("Select")
    expect(tooltip.textContent).toContain("V")
  })

  it("labels a child button primitive via asChild, keeping its own element", () => {
    render(
      <IconButton label="Project options" asChild>
        <button className="sidebar-action">
          <svg />
        </button>
      </IconButton>
    )
    const button = screen.getByRole("button", { name: "Project options" })
    expect(button.className).toBe("sidebar-action")
    expect(button.getAttribute("data-slot")).not.toBe("button")
  })

  it("still explains itself when disabled, from a wrapper that takes pointer events", async () => {
    render(
      <IconButton label="Send" hint="No coding agent detected" disabled>
        <svg />
      </IconButton>
    )
    const button = screen.getByRole("button", { name: "Send" })
    expect(button.hasAttribute("disabled")).toBe(true)
    const wrapper = button.parentElement!
    expect(wrapper.tagName).toBe("SPAN")
    await act(async () => {
      fireEvent.pointerMove(wrapper, { pointerType: "mouse" })
    })
    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip.textContent).toContain("Send")
    expect(tooltip.textContent).toContain("No coding agent detected")
  })
})

describe("CanvasToolbar", () => {
  it("names every tool button and reflects the armed tool as pressed", () => {
    const { result } = renderHook(() => useToolMode())
    const { rerender } = render(
      <CanvasToolbar toolMode={result.current} onClearMode={() => {}} />
    )
    for (const name of ["Select", "Frame", "Document", "Comment"]) {
      expect(screen.getByRole("button", { name })).toBeTruthy()
    }
    expect(
      screen
        .getByRole("button", { name: "Select" })
        .getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      screen.getByRole("button", { name: "Frame" }).getAttribute("aria-pressed")
    ).toBe("false")

    fireEvent.click(screen.getByRole("button", { name: "Frame" }))
    rerender(<CanvasToolbar toolMode={result.current} onClearMode={() => {}} />)
    expect(
      screen.getByRole("button", { name: "Frame" }).getAttribute("aria-pressed")
    ).toBe("true")
    expect(
      screen
        .getByRole("button", { name: "Select" })
        .getAttribute("aria-pressed")
    ).toBe("false")
  })
})
