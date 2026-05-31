import { describe, expect, it } from "vitest"

import { enumerateRepoSkills, type RepoSkillFs } from "@/lib/skills/repo-skills"

function skillMd(name: string, description = "A repo skill.") {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\nbody for ${name}`
}

/**
 * An in-memory {@link RepoSkillFs}. `entries` is what `.claude/skills/` lists
 * (`null` ⇒ the directory is absent); `files` serves reads by exact path.
 */
function fakeFs(opts: {
  entries?: string[] | null
  files?: Record<string, string>
}): RepoSkillFs {
  return {
    async list(dir) {
      return dir === ".claude/skills" ? opts.entries ?? null : null
    },
    async read(path) {
      return opts.files?.[path] ?? null
    },
  }
}

describe("enumerateRepoSkills", () => {
  it("discovers .claude/skills/*/SKILL.md and tags origin repo", async () => {
    const fs = fakeFs({
      entries: ["deploy", "lint"],
      files: {
        ".claude/skills/deploy/SKILL.md": skillMd("deploy", "Deploy it."),
        ".claude/skills/lint/SKILL.md": skillMd("lint", "Lint it."),
      },
    })

    const skills = await enumerateRepoSkills(fs)

    expect(skills).toEqual([
      { name: "deploy", description: "Deploy it.", origin: "repo" },
      { name: "lint", description: "Lint it.", origin: "repo" },
    ])
  })

  it("skips non-directory entries (no SKILL.md to read)", async () => {
    const fs = fakeFs({
      entries: ["README.md", "deploy"],
      files: { ".claude/skills/deploy/SKILL.md": skillMd("deploy") },
    })

    const skills = await enumerateRepoSkills(fs)

    expect(skills.map((s) => s.name)).toEqual(["deploy"])
  })

  it("skips directories without a SKILL.md", async () => {
    const fs = fakeFs({
      entries: ["empty", "deploy"],
      files: { ".claude/skills/deploy/SKILL.md": skillMd("deploy") },
    })

    const skills = await enumerateRepoSkills(fs)

    expect(skills.map((s) => s.name)).toEqual(["deploy"])
  })

  it("yields an empty list when .claude/skills is absent", async () => {
    expect(await enumerateRepoSkills(fakeFs({ entries: null }))).toEqual([])
  })

  it("yields an empty list when .claude/skills is empty", async () => {
    expect(await enumerateRepoSkills(fakeFs({ entries: [] }))).toEqual([])
  })

  it("enforces directory-name === name", async () => {
    const fs = fakeFs({
      entries: ["deploy"],
      // Declares a different name than its directory.
      files: { ".claude/skills/deploy/SKILL.md": skillMd("ship") },
    })

    await expect(enumerateRepoSkills(fs)).rejects.toThrow(/Names must match/)
  })
})
