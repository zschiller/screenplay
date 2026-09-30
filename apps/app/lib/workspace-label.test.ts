import { describe, expect, it } from "vitest"

import { workspaceLabel } from "@/lib/workspace-label"

describe("workspaceLabel", () => {
  it("names a Workspace by its title", () => {
    expect(workspaceLabel({ title: "Hero trust line" })).toBe("Hero trust line")
  })

  it("reads New Workspace, never the branch, when there is no title", () => {
    expect(workspaceLabel({})).toBe("New Workspace")
  })

  it("treats an empty or blank title as missing", () => {
    expect(workspaceLabel({ title: "" })).toBe("New Workspace")
    expect(workspaceLabel({ title: "   " })).toBe("New Workspace")
  })
})
