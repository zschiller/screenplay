import { describe, expect, it } from "vitest"

import type { SkillMetadata } from "@/lib/skills/frontmatter"
import type { OriginTaggedSkill } from "@/lib/skills/merged"
import { resolveSkillMenuSource } from "@/lib/skills/menu-source"

// App Skills carry their bundled `screenplay-` prefix; Repo Skills are
// repo-authored and named freely.
const app: SkillMetadata[] = [
  { name: "screenplay-add-knob", description: "Add a knob." },
  { name: "screenplay-share-state", description: "Share state." },
]

describe("resolveSkillMenuSource", () => {
  it("returns App Skills only (tagged app, sorted) when no Sandbox is present", () => {
    const menu = resolveSkillMenuSource(app, null)

    expect(menu).toEqual([
      {
        name: "screenplay-add-knob",
        description: "Add a knob.",
        origin: "app",
      },
      {
        name: "screenplay-share-state",
        description: "Share state.",
        origin: "app",
      },
    ])
  })

  it("keeps the screenplay- prefix on App Skills pre-Sandbox", () => {
    const menu = resolveSkillMenuSource(app, null)

    expect(menu.every((s) => s.name.startsWith("screenplay-"))).toBe(true)
    expect(menu.every((s) => s.origin === "app")).toBe(true)
  })

  it("returns App Skills only when a Sandbox has zero Repo Skills", () => {
    const menu = resolveSkillMenuSource(app, [])

    expect(menu.map((s) => s.name)).toEqual([
      "screenplay-add-knob",
      "screenplay-share-state",
    ])
    expect(menu.every((s) => s.origin === "app")).toBe(true)
  })

  it("returns the merged App + Repo set when a Sandbox is present", () => {
    const repo: OriginTaggedSkill[] = [
      { name: "deploy", description: "Repo deploy.", origin: "repo" },
    ]

    const menu = resolveSkillMenuSource(app, repo)

    expect(menu).toEqual([
      { name: "deploy", description: "Repo deploy.", origin: "repo" },
      {
        name: "screenplay-add-knob",
        description: "Add a knob.",
        origin: "app",
      },
      {
        name: "screenplay-share-state",
        description: "Share state.",
        origin: "app",
      },
    ])
  })

  it("lets a Repo Skill shadow an App Skill on a name collision", () => {
    const repo: OriginTaggedSkill[] = [
      {
        name: "screenplay-add-knob",
        description: "Repo override of add-knob.",
        origin: "repo",
      },
    ]

    const menu = resolveSkillMenuSource(app, repo)

    const knob = menu.filter((s) => s.name === "screenplay-add-knob")
    expect(knob).toEqual([
      {
        name: "screenplay-add-knob",
        description: "Repo override of add-knob.",
        origin: "repo",
      },
    ])
    // The shadowed App row is gone; only the Repo override and the other App
    // Skill remain.
    expect(menu.map((s) => s.name)).toEqual([
      "screenplay-add-knob",
      "screenplay-share-state",
    ])
  })
})
