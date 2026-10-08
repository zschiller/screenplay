// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest"
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react"
import { IconButton, shortcutKeys } from "@workspace/ui/components/icon-button"

import { CanvasToolbar, NO_REPOSITORY_HINT } from "./canvas-toolbar"
import { useToolMode } from "./use-tool-mode"
import { ViewingProvider } from "@/lib/viewer/context"

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
    for (const name of ["Select", "Frame", "Mockup", "Document", "Comment"]) {
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

  it("gives a viewer Select and Comment only (#1933)", () => {
    const { result } = renderHook(() => useToolMode())
    render(
      <ViewingProvider
        value={{
          person: { id: "ana", name: "Ana" },
          roomId: "room-1",
          shareKey: "key",
        }}
      >
        <CanvasToolbar toolMode={result.current} onClearMode={() => {}} />
      </ViewingProvider>
    )
    const tools = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
    expect(tools).toEqual(["Select", "Comment"])
  })

  it("puts Mockup between Frame and Document, on M (#1359)", () => {
    const { result } = renderHook(() => useToolMode())
    const { rerender } = render(
      <CanvasToolbar toolMode={result.current} onClearMode={() => {}} />
    )
    const names = screen
      .getAllByRole("button")
      .map((b) => b.getAttribute("aria-label"))
    expect(names.indexOf("Mockup")).toBe(names.indexOf("Frame") + 1)
    expect(names.indexOf("Document")).toBe(names.indexOf("Mockup") + 1)

    fireEvent.click(screen.getByRole("button", { name: "Mockup" }))
    rerender(<CanvasToolbar toolMode={result.current} onClearMode={() => {}} />)
    expect(result.current.mode).toBe("mockup")
  })
})

describe("Frame tool with no repository", () => {
  it("turns the Frame button off and says to add a repository first", async () => {
    const { result } = renderHook(() => useToolMode({ frameAvailable: false }))
    render(<CanvasToolbar toolMode={result.current} onClearMode={() => {}} />)
    const button = screen.getByRole("button", { name: "Frame" })
    expect(button.hasAttribute("disabled")).toBe(true)
    await act(async () => {
      fireEvent.pointerMove(button.parentElement!, { pointerType: "mouse" })
    })
    const tooltip = await screen.findByRole("tooltip")
    expect(tooltip.textContent).toContain(NO_REPOSITORY_HINT)
  })

  it("ignores F and the empty state's Add a frame", () => {
    const { result } = renderHook(() => useToolMode({ frameAvailable: false }))
    act(() => result.current.toggle("frame"))
    expect(result.current.mode).toBe("select")
    act(() => result.current.set("frame"))
    expect(result.current.mode).toBe("select")
    // Other tools still arm.
    act(() => result.current.toggle("mockup"))
    expect(result.current.mode).toBe("mockup")
  })

  it("drops an armed Frame tool when the last repository goes", () => {
    const { result, rerender } = renderHook(
      ({ frameAvailable }) => useToolMode({ frameAvailable }),
      { initialProps: { frameAvailable: true } }
    )
    act(() => result.current.set("frame"))
    expect(result.current.frameMode).toBe(true)
    rerender({ frameAvailable: false })
    expect(result.current.mode).toBe("select")
    expect(result.current.frameMode).toBe(false)
  })
})

describe("shortcutKeys", () => {
  it("splits leading modifier glyphs into their own keys", () => {
    expect(shortcutKeys("⌘B")).toEqual(["⌘", "B"])
    expect(shortcutKeys("⇧↵")).toEqual(["⇧", "↵"])
    expect(shortcutKeys("⌘⇧Z")).toEqual(["⌘", "⇧", "Z"])
    expect(shortcutKeys("V")).toEqual(["V"])
    expect(shortcutKeys(["Esc"])).toEqual(["Esc"])
  })
})
