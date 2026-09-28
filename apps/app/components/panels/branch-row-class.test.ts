import { describe, expect, it } from "vitest"
import { branchRowClassName } from "./branch-row-class"

const classes = (opts: { isPanelActive: boolean; isHighlighted?: boolean }) =>
  branchRowClassName(opts).split(" ")

describe("branchRowClassName", () => {
  it("has no selected background or dimming for an idle row", () => {
    const list = classes({ isPanelActive: false })
    expect(list).not.toContain("bg-sidebar-accent")
    expect(list).not.toContain("opacity-50")
    expect(list).toContain("hover:bg-sidebar-accent")
  })

  it("shows the selected background when the Workspace's chat is open", () => {
    const list = classes({ isPanelActive: true })
    expect(list).toContain("bg-sidebar-accent")
    expect(list).toContain("text-sidebar-accent-foreground")
    expect(list).toContain("hover:bg-sidebar-accent")
    // The old concatenation fused tokens like "...foregroundbg-sidebar-accent".
    expect(list.every((c) => !/foregroundbg|foregroundopacity/.test(c))).toBe(
      true
    )
  })

  it("wears the hover background while one of its frames is hovered", () => {
    const list = classes({ isPanelActive: false, isHighlighted: true })
    expect(list).toContain("bg-sidebar-accent")
    expect(list).toContain("text-sidebar-accent-foreground")
  })
})
