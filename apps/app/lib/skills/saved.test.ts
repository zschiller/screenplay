import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import { memoryFileIndex } from "@/lib/files/files"
import { memoryFileStore } from "@/lib/files/store"
import {
  createSavedSkills,
  prepareSkill,
  SKILL_MAX_BYTES,
  stripSkillPrivileges,
} from "@/lib/skills/saved"

const agent = { addedBy: "agent" as const, addedById: "chat-1" }

/** A Skill scope over in-memory fakes. */
function scope() {
  const index = memoryFileIndex()
  const store = memoryFileStore()
  return {
    skills: createSavedSkills({
      index,
      store,
      keyPrefix: "canvas/room-1/skills",
    }),
    index,
    store,
  }
}

const skillMd = (
  name: string,
  description = "Do the thing.",
  body = "Step one."
) => `---\nname: ${name}\ndescription: ${description}\n---\n${body}`

describe("saved skills", () => {
  it("saves a Skill that lists by name and description and reads back", async () => {
    const { skills } = scope()
    const saved = await skills.save({
      name: "release-notes",
      content: skillMd("release-notes", "Write release notes."),
      files: [{ path: "references/style.md", content: "Plain words." }],
      author: agent,
      now: 5,
    })

    expect(saved).toMatchObject({
      ok: true,
      value: { replaced: false, stripped: [] },
    })
    expect(await skills.list()).toEqual([
      {
        name: "release-notes",
        description: "Write release notes.",
        addedBy: "agent",
        addedById: "chat-1",
        createdAt: 5,
        updatedAt: 5,
      },
    ])
    const read = await skills.read("release-notes")
    expect(read.ok && read.value.content).toBe(
      skillMd("release-notes", "Write release notes.")
    )
    expect(read.ok && read.value.files).toEqual([
      { path: "references/style.md", content: "Plain words." },
    ])
  })

  it("replaces a Skill of the same name, dropping files the new one doesn’t have", async () => {
    const { skills, store } = scope()
    await skills.save({
      name: "review",
      content: skillMd("review", "Old."),
      files: [
        { path: "old/notes.md", content: "Old notes." },
        { path: "keep.md", content: "v1" },
      ],
      author: agent,
      now: 1,
    })
    const saved = await skills.save({
      name: "review",
      content: skillMd("review", "New."),
      files: [{ path: "keep.md", content: "v2" }],
      author: { addedBy: "agent", addedById: "chat-2" },
      now: 2,
    })

    expect(saved).toMatchObject({ ok: true, value: { replaced: true } })
    const [listed] = await skills.list()
    expect(listed).toMatchObject({
      description: "New.",
      addedById: "chat-2",
      createdAt: 1,
      updatedAt: 2,
    })
    const read = await skills.read("review")
    expect(read.ok && read.value.files).toEqual([
      { path: "keep.md", content: "v2" },
    ])
    // SKILL.md and keep.md: the old file's bytes went with it.
    expect(store.keys()).toHaveLength(2)
  })

  it("strips allowed-tools and !`command` lines when saving", async () => {
    const { skills } = scope()
    const saved = await skills.save({
      name: "deploy",
      content: [
        "---",
        "name: deploy",
        "allowed-tools:",
        "  - Bash(rm -rf *)",
        "description: Ship it.",
        "---",
        "Current branch: !`git branch --show-current`",
        "Then ship.",
      ].join("\n"),
      author: agent,
    })

    expect(saved).toMatchObject({
      ok: true,
      value: { stripped: ["allowed-tools", "!`command` lines"] },
    })
    const read = await skills.read("deploy")
    expect(read.ok && read.value.content).toBe(
      "---\nname: deploy\ndescription: Ship it.\n---\nThen ship."
    )
  })

  it("fits a copy of each design skill with its built page templates (#1642)", () => {
    // The repository's design skills hold the same built templates the App
    // Skills ship, so a copy saved to an account or canvas must fit.
    const skillsDir = join(process.cwd(), "..", "..", ".agents", "skills")
    for (const name of [
      "design-audit",
      "design-exploration",
      "design-storybook",
    ]) {
      const dir = join(skillsDir, name)
      const files = readdirSync(dir)
        .filter((f) => f !== "SKILL.md")
        .map((path) => ({
          path,
          content: readFileSync(join(dir, path), "utf8"),
        }))
      expect(
        files.some((f) => f.path.endsWith(".html")),
        name
      ).toBe(true)
      const content = readFileSync(join(dir, "SKILL.md"), "utf8")
      expect(prepareSkill({ name, content, files }), name).toMatchObject({
        ok: true,
      })
    }
  })

  it("refuses an invalid name, a mismatched name and a Skill over 1 MB", async () => {
    const { skills } = scope()
    const save = (name: string, content: string) =>
      skills.save({ name, content, author: agent })

    for (const name of ["Release", "re--lease", "-x", "a/b", "x".repeat(65)]) {
      expect(await save(name, skillMd(name)), name).toMatchObject({ ok: false })
    }
    expect(await save("one", skillMd("two"))).toMatchObject({
      ok: false,
      error: expect.stringContaining('must match the skill’s name, "one"'),
    })
    expect(
      await save("big", skillMd("big", "Big.", "x".repeat(SKILL_MAX_BYTES)))
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining("(1.0 MB)"),
    })
    expect(await save("bare", "no frontmatter")).toMatchObject({
      ok: false,
      error: expect.stringContaining("name: bare"),
    })
    expect(await save("long", skillMd("long", "d".repeat(1025)))).toMatchObject(
      { ok: false, error: expect.stringContaining("1024") }
    )
    expect(await skills.list()).toEqual([])
  })

  it("deletes a Skill with its files", async () => {
    const { skills, store } = scope()
    await skills.save({
      name: "review",
      content: skillMd("review"),
      files: [{ path: "a.md", content: "A" }],
      author: agent,
    })

    expect(await skills.remove("review")).toEqual({
      ok: true,
      value: undefined,
    })
    expect(await skills.list()).toEqual([])
    expect(store.keys()).toEqual([])
    expect(await skills.remove("review")).toMatchObject({ ok: false })
  })

  it("never lists a Skill whose save hasn’t finished", async () => {
    const { skills, index } = scope()
    // The folder and SKILL.md are in, but not yet the description.
    await index.mutate((tx) =>
      tx.set({
        id: "f1",
        path: "half",
        kind: "folder",
        size: 0,
        mediaType: "",
        addedBy: "agent",
        addedById: "chat-1",
        blobKey: "",
        createdAt: 1,
        updatedAt: 1,
      })
    )

    expect(await skills.list()).toEqual([])
    expect(await skills.read("half")).toMatchObject({ ok: false })
  })
})

describe("stripSkillPrivileges", () => {
  it("keeps everything else, and inline code without the !", () => {
    const content = "---\nname: a\ndescription: b\n---\nRun `pnpm test`."
    expect(stripSkillPrivileges(content)).toEqual({ content, stripped: [] })
  })

  it("strips a one-line allowed-tools and keeps the field after it", () => {
    const out = stripSkillPrivileges(
      "---\nname: a\nallowed-tools: Bash, Read\ndescription: b\n---\nbody"
    )
    expect(out.content).toBe("---\nname: a\ndescription: b\n---\nbody")
  })
})
