import { describe, expect, it } from "vitest"

import { hasWorkspaceTitle, workspaceLabel } from "@/lib/workspace-label"

describe("workspaceLabel", () => {
  it("names a Workspace by its title", () => {
    expect(
      workspaceLabel({ title: "Hero trust line", ref: "hero-trust-line" })
    ).toBe("Hero trust line")
    expect(hasWorkspaceTitle({ title: "Hero trust line" })).toBe(true)
  })

  it("falls back to the branch when there is no title", () => {
    expect(workspaceLabel({ ref: "hero-gradient" })).toBe("hero-gradient")
    expect(hasWorkspaceTitle({})).toBe(false)
  })

  it("treats an empty or blank title as missing", () => {
    expect(workspaceLabel({ title: "", ref: "hero-gradient" })).toBe(
      "hero-gradient"
    )
    expect(workspaceLabel({ title: "   ", ref: "hero-gradient" })).toBe(
      "hero-gradient"
    )
    expect(hasWorkspaceTitle({ title: "  " })).toBe(false)
  })
})
