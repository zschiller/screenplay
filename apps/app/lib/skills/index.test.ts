import { describe, expect, it } from "vitest"

import { getSkill, getSkillIndex, hasSkill } from "@/lib/skills"

describe("App Skills by audience", () => {
  it("keeps Coordinator Skills out of the Workspace agents' index", () => {
    const names = getSkillIndex().map((s) => s.name)

    expect(names).toContain("screenplay-add-knob")
    expect(names).not.toContain("screenplay-try-variants")
    expect(getSkill("screenplay-try-variants")).toBeNull()
    expect(hasSkill("screenplay-try-variants")).toBe(false)
  })

  it("gives the Coordinator only its own Skills", () => {
    const names = getSkillIndex("coordinator").map((s) => s.name)

    expect(names).toEqual(["screenplay-try-variants"])
    expect(getSkill("screenplay-add-knob", "coordinator")).toBeNull()
    expect(getSkill("screenplay-try-variants", "coordinator")).toContain(
      "create_workspaces"
    )
  })
})
