import { describe, expect, it } from "vitest"

import {
  formatMergedListing,
  mergeSkillIndexes,
  resolveSkillBody,
} from "@/lib/skills/merged"
import type { SkillMetadata } from "@/lib/skills/frontmatter"
import type { OriginTaggedSkill } from "@/lib/skills/merged"

const app: SkillMetadata[] = [
  { name: "knobs", description: "App knobs." },
  { name: "state", description: "App state." },
]

const repo: OriginTaggedSkill[] = [
  { name: "deploy", description: "Repo deploy.", origin: "repo" },
]

describe("mergeSkillIndexes", () => {
  it("tags origin and sorts by name", () => {
    const merged = mergeSkillIndexes({ app, repo })

    expect(merged).toEqual([
      { name: "deploy", description: "Repo deploy.", origin: "repo" },
      { name: "knobs", description: "App knobs.", origin: "app" },
      { name: "state", description: "App state.", origin: "app" },
    ])
  })

  it("lets a Repo Skill win on a name collision (App row dropped)", () => {
    const collidingRepo: OriginTaggedSkill[] = [
      { name: "knobs", description: "Repo override of knobs.", origin: "repo" },
    ]

    const merged = mergeSkillIndexes({ app, repo: collidingRepo })

    const knobs = merged.filter((s) => s.name === "knobs")
    expect(knobs).toEqual([
      { name: "knobs", description: "Repo override of knobs.", origin: "repo" },
    ])
    // The shadowed App row is gone; only the Repo one remains.
    expect(merged.map((s) => s.name)).toEqual(["knobs", "state"])
  })
})

describe("mergeSkillIndexes with canvas Skills", () => {
  const canvas: SkillMetadata[] = [
    { name: "knobs", description: "Canvas knobs." },
    { name: "deploy", description: "Canvas deploy." },
    { name: "review", description: "Canvas review." },
  ]

  it("ranks Repo over Canvas over App", () => {
    const merged = mergeSkillIndexes({ app, canvas, repo })

    expect(merged).toEqual([
      { name: "deploy", description: "Repo deploy.", origin: "repo" },
      { name: "knobs", description: "Canvas knobs.", origin: "canvas" },
      { name: "review", description: "Canvas review.", origin: "canvas" },
      { name: "state", description: "App state.", origin: "app" },
    ])
  })

  it("leaves out a source the chat doesn't have (the Coordinator's repo)", () => {
    const merged = mergeSkillIndexes({ app, canvas })

    expect(merged.map((s) => [s.name, s.origin])).toEqual([
      ["deploy", "canvas"],
      ["knobs", "canvas"],
      ["review", "canvas"],
      ["state", "app"],
    ])
  })
})

describe("resolveSkillBody", () => {
  it("reads Repo, then Canvas, then App", async () => {
    const readers = {
      repo: async (n: string) => (n === "a" ? "REPO A" : null),
      canvas: async (n: string) =>
        n === "a" || n === "b" ? `CANVAS ${n}` : null,
      app: (n: string) => `APP ${n}`,
    }

    expect(await resolveSkillBody("a", readers)).toBe("REPO A")
    expect(await resolveSkillBody("b", readers)).toBe("CANVAS b")
    expect(await resolveSkillBody("c", readers)).toBe("APP c")
  })

  it("reads sandbox-first when a Repo Skill exists", async () => {
    const body = await resolveSkillBody("knobs", {
      repo: async () => "REPO BODY",
      app: () => "APP BODY",
    })

    expect(body).toBe("REPO BODY")
  })

  it("falls back to the App Skill when no Repo Skill matches", async () => {
    const body = await resolveSkillBody("knobs", {
      repo: async () => null,
      app: () => "APP BODY",
    })

    expect(body).toBe("APP BODY")
  })

  it("returns null when neither source has the skill", async () => {
    const body = await resolveSkillBody("nope", {
      repo: async () => null,
      app: () => null,
    })

    expect(body).toBeNull()
  })
})

describe("formatMergedListing", () => {
  it("lists the merged set as name + description bullets", () => {
    const listing = formatMergedListing(mergeSkillIndexes({ app, repo }))

    expect(listing).toContain("- deploy: Repo deploy.")
    expect(listing).toContain("- knobs: App knobs.")
    expect(listing).toContain("- state: App state.")
  })

  it("reads (none) when the merged set is empty", () => {
    expect(formatMergedListing([])).toBe("(none)")
  })
})
