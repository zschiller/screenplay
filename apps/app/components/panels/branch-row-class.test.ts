import { describe, expect, it } from "vitest"
import { branchRowClassName } from "./branch-row-class"

const classes = (opts: { isPanelActive: boolean; isLoading: boolean }) =>
  branchRowClassName(opts).split(" ")

describe("branchRowClassName", () => {
  it("has no selected background or dimming for an idle row", () => {
    const list = classes({ isPanelActive: false, isLoading: false })
    expect(list).not.toContain("bg-sidebar-accent")
    expect(list).not.toContain("opacity-50")
    expect(list).toContain("hover:bg-sidebar-accent")
  })

  it("shows the selected background when the Workspace's chat is open", () => {
    const list = classes({ isPanelActive: true, isLoading: false })
    expect(list).toContain("bg-sidebar-accent")
    expect(list).toContain("text-sidebar-accent-foreground")
    expect(list).toContain("hover:bg-sidebar-accent")
    expect(list).not.toContain("opacity-50")
  })

  it("dims a Workspace that is still starting", () => {
    const list = classes({ isPanelActive: false, isLoading: true })
    expect(list).toContain("opacity-50")
    expect(list).not.toContain("bg-sidebar-accent")
  })

  it("keeps every class a separate token when active and loading", () => {
    const list = classes({ isPanelActive: true, isLoading: true })
    expect(list).toContain("bg-sidebar-accent")
    expect(list).toContain("opacity-50")
    // The old concatenation fused tokens like "...foregroundbg-sidebar-accent".
    expect(list.every((c) => !/foregroundbg|foregroundopacity/.test(c))).toBe(
      true
    )
  })
})
