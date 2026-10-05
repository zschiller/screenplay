import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { agentSkillsFor } from "@/lib/skills/agent-skills"
import { appSkillSource } from "@/lib/skills"
import { memoryFileIndex } from "@/lib/files/files"
import { memoryFileStore } from "@/lib/files/store"
import { createSavedSkills } from "@/lib/skills/saved"
import { skillSources } from "@/lib/skills/sources"

/**
 * Harness Skills (#1560): the desktop agent's own Skills, read from a fake
 * home folder, and where they rank in the merged index.
 */

let home: string

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "agent-skills-"))
})
afterEach(async () => {
  await rm(home, { recursive: true, force: true })
})

async function skill(dir: string, folder: string, content: string) {
  await mkdir(join(home, dir, folder), { recursive: true })
  await writeFile(join(home, dir, folder, "SKILL.md"), content)
}

const skillMd = (name: string, description: string, body = "") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`

/** A canvas's saved Skills holding `name`. */
async function savedWith(name: string) {
  const saved = createSavedSkills({
    index: memoryFileIndex(),
    store: memoryFileStore(),
    keyPrefix: "canvas/room-1/skills",
  })
  await saved.save({
    name,
    content: skillMd(name, "Canvas."),
    author: { addedBy: "agent", addedById: "chat-1" },
  })
  return saved
}

describe("agentSkillsFor", () => {
  it("reads a file beside a Skill's SKILL.md, and none outside its folder", async () => {
    await skill(".claude/skills", "tidy", skillMd("tidy", "Tidy up."))
    await writeFile(join(home, ".claude/skills/tidy/notes.md"), "NOTES")

    const agent = agentSkillsFor("claude-code", home)!
    expect(await agent.file("tidy", "notes.md")).toBe("NOTES")
    expect(await agent.file("tidy", "gone.md")).toBeNull()
    expect(await agent.file("tidy", "../tidy/notes.md")).toBe("NOTES")
    expect(await agent.file("tidy", "../../x")).toBeNull()
    expect(await agent.file("nope", "notes.md")).toBeUndefined()
  })

  it("lists Claude Code's ~/.claude/skills, named Claude Code", async () => {
    await skill(".claude/skills", "tidy", skillMd("tidy", "Tidy up.", "TIDY"))
    await skill(".agents/skills", "codex-only", skillMd("codex-only", "No."))

    const agent = agentSkillsFor("claude-code", home)!
    expect(agent.agentName).toBe("Claude Code")
    expect(await agent.index()).toEqual([
      { name: "tidy", description: "Tidy up." },
    ])
    expect(await agent.read("tidy")).toBe(skillMd("tidy", "Tidy up.", "TIDY"))
    expect(await agent.read("codex-only")).toBeNull()
  })

  it("lists Codex's ~/.agents/skills before its older ~/.codex/skills", async () => {
    await skill(".agents/skills", "ship", skillMd("ship", "New ship."))
    await skill(".codex/skills", "ship", skillMd("ship", "Old ship."))
    await skill(".codex/skills", "old", skillMd("old", "Old one."))

    const agent = agentSkillsFor("codex", home)!
    expect(agent.agentName).toBe("Codex")
    expect(await agent.index()).toEqual([
      { name: "old", description: "Old one." },
      { name: "ship", description: "New ship." },
    ])
  })

  it("lists Claude Code's synced skills and Codex's own (.system)", async () => {
    await skill(".claude/skills", "tidy", skillMd("tidy", "Tidy up."))
    await skill(".claude/skills/synced/abc", "pdf", skillMd("pdf", "PDFs."))
    await skill(".claude/skills/.trash", "old", skillMd("old", "Gone."))
    await skill(
      ".codex/skills/.system",
      "imagegen",
      skillMd("imagegen", "Img.")
    )

    expect(
      (await agentSkillsFor("claude-code", home)!.index()).map((s) => s.name)
    ).toEqual(["pdf", "tidy"])
    expect(
      (await agentSkillsFor("codex", home)!.index()).map((s) => s.name)
    ).toEqual(["imagegen"])
  })

  it("leaves out what it can't read, and reads a block description", async () => {
    await skill(".claude/skills", "broken", "no frontmatter here")
    await skill(
      ".claude/skills",
      "long",
      "---\nname: long\ndescription: >\n  Spans two\n  lines.\n---\nBody"
    )
    await mkdir(join(home, ".claude/skills/empty-folder"), { recursive: true })
    await writeFile(join(home, ".claude/skills/README.md"), "not a skill")

    expect(await agentSkillsFor("claude-code", home)!.index()).toEqual([
      { name: "long", description: "Spans two lines." },
    ])
  })

  it("lists none when the folder is missing", async () => {
    expect(await agentSkillsFor("claude-code", home)!.index()).toEqual([])
  })

  it("has none off a Harness", () => {
    expect(agentSkillsFor(null, home)).toBeNull()
    expect(agentSkillsFor("nope", home)).toBeNull()
  })

  it("ranks below the repository and canvas, above App Skills", async () => {
    await skill(".claude/skills", "deploy", skillMd("deploy", "Mine."))
    await skill(".claude/skills", "review", skillMd("review", "Mine."))
    await skill(
      ".claude/skills",
      "screenplay-add-knob",
      skillMd("screenplay-add-knob", "My knobs.")
    )
    await skill(".claude/skills", "notes", skillMd("notes", "Mine."))

    const merged = await skillSources({
      repo: async () => ({
        list: async () => ["deploy"],
        read: async (path) =>
          path === ".claude/skills/deploy/SKILL.md"
            ? skillMd("deploy", "Repo.")
            : null,
      }),
      canvas: await savedWith("review"),
      agent: agentSkillsFor("claude-code", home),
      app: appSkillSource(),
    }).index()
    const of = (name: string) => merged.find((s) => s.name === name)
    expect(of("deploy")).toMatchObject({ origin: "repo" })
    expect(of("review")).toMatchObject({ origin: "canvas" })
    expect(of("notes")).toMatchObject({ origin: "agent" })
    expect(of("screenplay-add-knob")).toEqual({
      name: "screenplay-add-knob",
      description: "My knobs.",
      origin: "agent",
    })
  })
})
