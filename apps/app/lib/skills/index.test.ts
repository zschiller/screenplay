import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { getSkill, getSkillIndex, hasSkill, loadAppSkills } from "@/lib/skills"
import { SKILL_FILE_SHOWN_MAX_BYTES } from "@/lib/skills/saved"

describe("App Skills by audience", () => {
  it("keeps Coordinator Skills out of the Workspace agents' index", () => {
    const names = getSkillIndex().map((s) => s.name)

    expect(names).toContain("screenplay-add-knob")
    expect(names).toContain("screenplay-explore-with-mockups")
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

describe("App Skills with supporting files (#1642)", () => {
  /** A `lib/skills/` folder holding one Skill with a template beside it. */
  function fixture() {
    const dir = mkdtempSync(join(tmpdir(), "app-skills-"))
    const skill = join(dir, "screenplay-explore")
    mkdirSync(join(skill, "templates"), { recursive: true })
    writeFileSync(
      join(skill, "SKILL.md"),
      "---\nname: screenplay-explore\ndescription: Explore a design.\n---\nFill `templates/page.html`."
    )
    writeFileSync(join(skill, "templates", "page.html"), "<main></main>")
    writeFileSync(
      join(skill, "runtime.js"),
      "x".repeat(SKILL_FILE_SHOWN_MAX_BYTES + 1)
    )
    return loadAppSkills(dir)
  }

  it("loads the files beside a Skill’s SKILL.md, at any depth", () => {
    expect(fixture().open("screenplay-explore")).toEqual({
      content:
        "---\nname: screenplay-explore\ndescription: Explore a design.\n---\nFill `templates/page.html`.",
      files: [
        {
          path: "runtime.js",
          content: "x".repeat(SKILL_FILE_SHOWN_MAX_BYTES + 1),
        },
        { path: "templates/page.html", content: "<main></main>" },
      ],
    })
  })

  it("shows its files when read, naming one too large to show", () => {
    const read = fixture().read("screenplay-explore")

    expect(read).toContain("Fill `templates/page.html`.")
    expect(read).toContain(
      "This skill’s file `templates/page.html`:\n\n<main></main>"
    )
    expect(read).toContain(
      "This skill’s file `runtime.js` (64.0 KB) is too large to show here."
    )
    expect(read).not.toContain("xxxx")
  })

  it("carries the files a saved copy doesn’t replace", () => {
    const changed = {
      path: "templates/page.html",
      content: "<main>mine</main>",
    }

    expect(fixture().carryFiles("screenplay-explore", [changed])).toEqual({
      files: [
        changed,
        {
          path: "runtime.js",
          content: "x".repeat(SKILL_FILE_SHOWN_MAX_BYTES + 1),
        },
      ],
      carried: ["runtime.js"],
    })
    expect(fixture().carryFiles("my-own-skill", [changed])).toEqual({
      files: [changed],
      carried: [],
    })
  })
})
