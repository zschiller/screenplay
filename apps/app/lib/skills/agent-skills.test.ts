import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { agentSkillsFor } from "@/lib/skills/agent-skills"
import { getSkillIndex } from "@/lib/skills"
import { mergeSkillIndexes } from "@/lib/skills/merged"

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

describe("agentSkillsFor", () => {
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

    const merged = mergeSkillIndexes({
      repo: [{ name: "deploy", description: "Repo." }],
      canvas: [{ name: "review", description: "Canvas." }],
      agent: await agentSkillsFor("claude-code", home)!.index(),
      app: getSkillIndex(),
    })
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
