import { describe, expect, it } from "vitest"

import { workspaceLabel } from "@/lib/workspace-label"

describe("workspaceLabel", () => {
  it("names a Workspace by its title", () => {
    expect(workspaceLabel({ title: "Hero trust line" })).toBe("Hero trust line")
  })

  it("reads New chat, never the branch, when there is no title", () => {
    expect(workspaceLabel({})).toBe("New chat")
  })

  it("treats an empty or blank title as missing", () => {
    expect(workspaceLabel({ title: "" })).toBe("New chat")
    expect(workspaceLabel({ title: "   " })).toBe("New chat")
  })
})
