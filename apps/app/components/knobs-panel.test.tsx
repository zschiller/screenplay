// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { KnobsPanel, knobSections } from "./knobs-panel"

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

describe("KnobsPanel layout", () => {
  it("gathers knobs by group, ungrouped first, groups in declaration order", () => {
    const defs = [
      { type: "boolean", id: "a", default: true, group: "Hero" },
      { type: "boolean", id: "b", default: true },
      { type: "boolean", id: "c", default: true, group: "Brand" },
      { type: "boolean", id: "d", default: true, group: "Hero" },
    ] as const
    expect(
      knobSections([...defs]).map((s) => [s.group, s.defs.map((d) => d.id)])
    ).toEqual([
      [undefined, ["b"]],
      ["Hero", ["a", "d"]],
      ["Brand", ["c"]],
    ])
  })

  it("heads each group and shows a description from the label's info icon", async () => {
    render(
      <KnobsPanel
        knobs={[
          {
            type: "slider",
            id: "radius",
            label: "Corner radius",
            description: "Buttons, cards and inputs",
            group: "Brand",
            min: 0,
            max: 28,
            default: 14,
          },
          { type: "boolean", id: "logos", label: "Logos", default: true },
        ]}
        values={{}}
        onChange={() => {}}
        empty={null}
      />
    )
    expect(screen.getByText("Brand")).toBeTruthy()
    expect(screen.queryByRole("button", { name: "About Logos" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "About Corner radius" }))
    expect(
      (await screen.findAllByText("Buttons, cards and inputs")).length
    ).toBeGreaterThan(0)
  })

  it("shows a colour knob as its hex value", () => {
    const onChange = vi.fn()
    render(
      <KnobsPanel
        knobs={[
          { type: "color", id: "accent", label: "Accent", default: "#4f46e5" },
        ]}
        values={{}}
        onChange={onChange}
        empty={null}
      />
    )
    expect(screen.getByText("4f46e5")).toBeTruthy()
    fireEvent.input(screen.getByLabelText("Accent"), {
      target: { value: "#ff0000" },
    })
    expect(onChange).toHaveBeenCalledWith({ accent: "#ff0000" })
  })
})
