import { describe, expect, it } from "vitest"

import { workspaceLabel } from "@/lib/workspace-label"

describe("workspaceLabel", () => {
  it("names a Workspace by its title", () => {
    expect(workspaceLabel({ title: "Hero trust line" })).toBe("Hero trust line")
  })

  it("reads New workspace, never the branch, when there is no title", () => {
    expect(workspaceLabel({})).toBe("New workspace")
  })

  it("treats an empty or blank title as missing", () => {
    expect(workspaceLabel({ title: "" })).toBe("New workspace")
    expect(workspaceLabel({ title: "   " })).toBe("New workspace")
  })
})
