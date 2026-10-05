import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { memoryFileIndex } from "@/lib/files/files"
import { memoryFileStore } from "@/lib/files/store"
import type { AgentSkills } from "@/lib/skills/agent-skills"
import type { AppSkills } from "@/lib/skills"
import type { RepoSkillFs } from "@/lib/skills/repo-skills"
import { createSavedSkills, type SavedSkills } from "@/lib/skills/saved"
import {
  formatSkillListing,
  skillSources,
  type SkillSourceInputs,
} from "@/lib/skills/sources"

/**
 * Skill Sources (#1664): one chat's Skills from every source, over the
 * in-memory fakes, through the module's interface.
 */

const skillMd = (name: string, from: string) =>
  `---\nname: ${name}\ndescription: ${from} ${name}.\n---\n${from.toUpperCase()} ${name}`

type Folder = Record<string, string>

/** A Branch's `.claude/skills/`: each Skill's files by path. */
function repo(skills: Record<string, Folder>): () => Promise<RepoSkillFs> {
  return async () => ({
    list: async (dir) =>
      dir === ".claude/skills" ? Object.keys(skills) : null,
    read: async (path) => {
      const m = path.match(/^\.claude\/skills\/([^/]+)\/(.+)$/)
      return (m && skills[m[1]!]?.[m[2]!]) ?? null
    },
  })
}

async function saved(
  keyPrefix: string,
  skills: Record<string, Folder>
): Promise<SavedSkills> {
  const scope = createSavedSkills({
    index: memoryFileIndex(),
    store: memoryFileStore(),
    keyPrefix,
  })
  for (const [name, { "SKILL.md": content, ...files }] of Object.entries(
    skills
  )) {
    await scope.save({
      name,
      content: content!,
      files: Object.entries(files).map(([path, c]) => ({ path, content: c })),
      author: { addedBy: "agent", addedById: "chat-1" },
    })
  }
  return scope
}

function agent(skills: Record<string, Folder>): AgentSkills {
  return {
    agentName: "Claude Code",
    index: async () =>
      Object.keys(skills).map((name) => ({
        name,
        description: `Agent ${name}.`,
      })),
    read: async (name) => skills[name]?.["SKILL.md"] ?? null,
    file: async (name, path) =>
      skills[name] ? (skills[name][path] ?? null) : undefined,
  }
}

function app(skills: Record<string, Folder>): AppSkills {
  const open = (name: string) => {
    const skill = skills[name]
    if (!skill) return null
    const { "SKILL.md": content, ...files } = skill
    return {
      content: content!,
      files: Object.entries(files).map(([path, c]) => ({ path, content: c })),
    }
  }
  return {
    index: () =>
      Object.keys(skills).map((name) => ({
        name,
        description: `App ${name}.`,
      })),
    read: (name) => open(name)?.content ?? null,
    open,
  }
}

/** The five sources, each holding the name it should win and the ones it loses. */
async function everySource(): Promise<SkillSourceInputs> {
  const names = ["a", "b", "c", "d", "e"]
  // Each source holds its own name and every higher-ranked source's.
  const from = (who: string, last: number) =>
    Object.fromEntries(
      names
        .slice(0, last + 1)
        .map((n) => [
          n,
          { "SKILL.md": skillMd(n, who), "t.txt": `${who} ${n}` },
        ])
    )
  return {
    repo: repo(from("repo", 0)),
    canvas: await saved("canvas/room-1/skills", from("canvas", 1)),
    account: await saved("account/u1/skills", from("account", 2)),
    agent: agent(from("agent", 3)),
    app: app(from("app", 4)),
  }
}

describe("skillSources", () => {
  it("ranks Repo, then Canvas, then Account, then the agent’s own, then App", async () => {
    const skills = skillSources(await everySource())

    expect(
      (await skills.index()).map((s) => [s.name, s.origin, s.description])
    ).toEqual([
      ["a", "repo", "repo a."],
      ["b", "canvas", "canvas b."],
      ["c", "account", "account c."],
      ["d", "agent", "Agent d."],
      ["e", "app", "App e."],
    ])
    for (const [name, who] of [
      ["a", "REPO"],
      ["b", "CANVAS"],
      ["c", "ACCOUNT"],
      ["d", "AGENT"],
      ["e", "APP"],
    ] as const) {
      expect(await skills.read(name)).toContain(`${who} ${name}`)
    }
    expect(await skills.read("nope")).toBeNull()
    expect(await skills.holders("c")).toEqual(["account", "agent", "app"])
  })

  it("reads a supporting file from the Skill that wins its name", async () => {
    const skills = skillSources(await everySource())

    expect(await skills.file("a", "t.txt")).toBe("repo a")
    expect(await skills.file("b", "t.txt")).toBe("canvas b")
    expect(await skills.file("c", "t.txt")).toBe("account c")
    expect(await skills.file("d", "t.txt")).toBe("agent d")
    expect(await skills.file("e", "t.txt")).toBe("app e")
    expect(await skills.file("b", "SKILL.md")).toBe(skillMd("b", "canvas"))
    // The winner has no such file: a lower source's never stands in for it.
    expect(await skills.file("b", "gone.txt")).toBeNull()
    expect(await skills.file("nope", "t.txt")).toBeNull()
  })

  it("shows a saved Skill’s files in what `read_skill` reads", async () => {
    const skills = skillSources(await everySource())

    expect(await skills.read("b")).toContain(
      "This skill’s file `t.txt`:\n\ncanvas b"
    )
  })

  it("leaves out a source the chat doesn’t have, and one that can’t be read", async () => {
    const broken: SavedSkills = {
      ...(await saved("canvas/room-1/skills", {})),
      list: async () => {
        throw new Error("store down")
      },
      read: async () => {
        throw new Error("store down")
      },
    }
    const skills = skillSources({
      canvas: broken,
      app: app({ e: { "SKILL.md": skillMd("e", "app") } }),
    })

    expect(await skills.index()).toEqual([
      { name: "e", description: "App e.", origin: "app" },
    ])
    expect(await skills.read("e")).toBe(skillMd("e", "app"))
  })

  it("lists App Skills alone for text built before a turn", async () => {
    const skills = skillSources({
      ...(await everySource()),
      app: app({ e: { "SKILL.md": skillMd("e", "app") } }),
    })
    expect(skills.appIndex()).toEqual([{ name: "e", description: "App e." }])
    expect(formatSkillListing(skills.appIndex())).toBe("- e: App e.")
    expect(formatSkillListing([])).toBe("(none)")
  })
})

describe("skillSources on disk", () => {
  let dir: string
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "skill-sources-"))
  })
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  async function tree(root: string, prefix = ""): Promise<string[]> {
    const out: string[] = []
    for (const e of await readdir(root, { withFileTypes: true })) {
      const path = `${prefix}${e.name}`
      if (e.isDirectory())
        out.push(...(await tree(join(root, e.name), `${path}/`)))
      else out.push(path)
    }
    return out.sort()
  }

  it("writes each winning Skill the harness doesn’t load itself, for Claude Code and Codex", async () => {
    const sections = skillSources(await everySource()).contextSections()
    expect(Object.keys(sections).sort()).toEqual([".agents", ".claude"])

    for (const [name, section] of Object.entries(sections)) {
      await section(join(dir, name))
    }

    // The repository's and the agent's own Skills stay where the harness
    // reads them: the checkout and the user's home.
    for (const harness of [".claude", ".agents"]) {
      expect(await tree(join(dir, harness))).toEqual([
        "skills/b/SKILL.md",
        "skills/b/t.txt",
        "skills/c/SKILL.md",
        "skills/c/t.txt",
        "skills/e/SKILL.md",
        "skills/e/t.txt",
      ])
    }
    expect(await readFile(join(dir, ".agents/skills/c/t.txt"), "utf8")).toBe(
      "account c"
    )
    expect(await readFile(join(dir, ".claude/skills/b/SKILL.md"), "utf8")).toBe(
      skillMd("b", "canvas")
    )
  })

  it("replaces what an earlier turn wrote", async () => {
    const canvas = await saved("canvas/room-1/skills", {
      x: { "SKILL.md": skillMd("x", "canvas") },
      y: { "SKILL.md": skillMd("y", "canvas") },
    })
    const write = () =>
      skillSources({ canvas, app: app({}) }).contextSections()[".claude"]!(
        join(dir, ".claude")
      )
    await write()
    await canvas.remove("x")
    await write()

    expect(await readdir(join(dir, ".claude/skills"))).toEqual(["y"])
  })
})
