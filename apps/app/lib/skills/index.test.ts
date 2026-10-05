import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  appSkills,
  getSkill,
  getSkillIndex,
  hasSkill,
  loadAppSkills,
} from "@/lib/skills"
import {
  prepareSkill,
  SKILL_FILE_SHOWN_MAX_BYTES,
  SKILL_MAX_BYTES,
} from "@/lib/skills/saved"

describe("Screenplay's own App Skills", () => {
  it("each fit, with their files, the size a saved skill may be", () => {
    // A saved copy of an App Skill keeps its files (#1642), so each must
    // save whole. The design audit skill is closest to the limit.
    const all = [
      ...getSkillIndex().map((s) => appSkills.open(s.name)!),
      ...getSkillIndex("coordinator").map((s) =>
        appSkills.open(s.name, "coordinator")!
      ),
    ]
    expect(all.length).toBeGreaterThan(0)
    for (const [i, { content, files }] of all.entries()) {
      const name = content.match(/^name:\s*(\S+)/m)![1]!
      const prepared = prepareSkill({ name, content, files })
      expect(prepared, `${name} (skill ${i})`).toMatchObject({ ok: true })
      const size = [content, ...files.map((f) => f.content)].reduce(
        (n, c) => n + Buffer.byteLength(c),
        0
      )
      expect(size, name).toBeLessThanOrEqual(SKILL_MAX_BYTES)
    }
  })
})

describe("App Skills by audience", () => {
  it("keeps Coordinator Skills out of the Workspace agents' index", () => {
    const names = getSkillIndex().map((s) => s.name)

    expect(names).toContain("screenplay-add-knob")
    expect(names).toContain("screenplay-design-exploration")
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
