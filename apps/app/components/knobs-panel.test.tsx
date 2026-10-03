// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { KnobsPanel } from "./knobs-panel"

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver

afterEach(cleanup)

const option = (value: string) => ({ value, label: value.toUpperCase() })

describe("KnobsPanel tabs knobs", () => {
  it("shows two or three options as tabs and sets the picked one", () => {
    const onChange = vi.fn()
    render(
      <KnobsPanel
        knobs={[
          {
            type: "tabs",
            id: "size",
            label: "Size",
            default: "m",
            options: ["s", "m", "l"].map(option),
          },
        ]}
        values={{}}
        onChange={onChange}
        empty={null}
      />
    )
    expect(screen.getByRole("tab", { name: "M" })).toHaveProperty(
      "ariaSelected",
      "true"
    )
    // Radix tabs activate on mouse down.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "L" }))
    expect(onChange).toHaveBeenCalledWith({ size: "l" })
  })

  it("shows more than three options as a select instead", () => {
    render(
      <KnobsPanel
        knobs={[
          {
            type: "tabs",
            id: "size",
            label: "Size",
            default: "m",
            options: ["xs", "s", "m", "l"].map(option),
          },
        ]}
        values={{}}
        onChange={() => {}}
        empty={null}
      />
    )
    expect(screen.queryByRole("tab")).toBeNull()
    expect(screen.getByRole("combobox")).toBeTruthy()
  })

  it("puts a shared frame's Theme knob first, as tabs", () => {
    const onTheme = vi.fn()
    render(
      <KnobsPanel
        knobs={[]}
        values={{}}
        onChange={() => {}}
        empty={<p>No knobs from this page yet</p>}
        theme={{ value: "light", onChange: onTheme }}
      />
    )
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Dark" }))
    expect(onTheme).toHaveBeenCalledWith("dark")
    expect(screen.getByText("No knobs from this page yet")).toBeTruthy()
  })
})
