import { describe, expect, it } from "vitest"

import { reduceToolMode, type ToolMode } from "@/lib/canvas/tool-mode"

// Plain fixtures — no React. `reduceToolMode` is pure: a mode + an event in, the
// next mode out. These pin that pressing each tool arms exactly that one mode
// (mutual exclusion is by construction — one value, not three booleans) and that
// toggling a tool a second time returns to Select.

describe("reduceToolMode — set", () => {
  it("arms the named mode unconditionally", () => {
    const tools: ToolMode[] = ["select", "frame", "comment", "document"]
    for (const from of tools) {
      expect(reduceToolMode(from, { type: "set", mode: "select" })).toBe(
        "select"
      )
      expect(reduceToolMode(from, { type: "set", mode: "frame" })).toBe("frame")
    }
  })
})

describe("reduceToolMode — toggle", () => {
  it("arms the tool from Select", () => {
    expect(reduceToolMode("select", { type: "toggle", tool: "frame" })).toBe(
      "frame"
    )
    expect(reduceToolMode("select", { type: "toggle", tool: "document" })).toBe(
      "document"
    )
    expect(reduceToolMode("select", { type: "toggle", tool: "comment" })).toBe(
      "comment"
    )
  })

  it("returns to Select when the active tool is toggled again", () => {
    expect(reduceToolMode("frame", { type: "toggle", tool: "frame" })).toBe(
      "select"
    )
    expect(
      reduceToolMode("document", { type: "toggle", tool: "document" })
    ).toBe("select")
    expect(reduceToolMode("comment", { type: "toggle", tool: "comment" })).toBe(
      "select"
    )
  })

  it("switches directly between tools (the previous tool drops by construction)", () => {
    expect(reduceToolMode("frame", { type: "toggle", tool: "document" })).toBe(
      "document"
    )
    expect(reduceToolMode("comment", { type: "toggle", tool: "frame" })).toBe(
      "frame"
    )
  })
})
