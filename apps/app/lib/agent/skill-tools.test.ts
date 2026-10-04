import { describe, expect, it } from "vitest"

import { buildSkillTools } from "@/lib/agent/skill-tools"
import { memoryFileIndex } from "@/lib/files/files"
import { memoryFileStore } from "@/lib/files/store"
import { appSkillSource } from "@/lib/skills"
import type { RepoSkillFs } from "@/lib/skills/repo-skills"
import { createSavedSkills, type SavedSkills } from "@/lib/skills/saved"

/** One canvas's saved Skills, the way every chat on it shares them. */
function canvas(): SavedSkills {
  return createSavedSkills({
    index: memoryFileIndex(),
    store: memoryFileStore(),
    keyPrefix: "canvas/room-1/skills",
  })
}

/** A Branch's `.claude/skills/`, in memory. */
function repoFs(skills: Record<string, string>): RepoSkillFs {
  return {
    list: async (dir) =>
      dir === ".claude/skills" ? Object.keys(skills) : null,
    read: async (path) => {
      const m = path.match(/^\.claude\/skills\/([^/]+)\/SKILL\.md$/)
      return (m && skills[m[1]!]) ?? null
    },
  }
}

const skillMd = (name: string, description: string, body = "") =>
  `---\nname: ${name}\ndescription: ${description}\n---\n${body}`

type Tools = ReturnType<typeof buildSkillTools>

async function run(tools: Tools, name: keyof Tools, input: object) {
  const execute = tools[name].execute as (
    input: object,
    options: object
  ) => Promise<unknown>
  return (await execute(input, {
    toolCallId: "t1",
    messages: [],
    context: {},
  })) as string
}

describe("skill tools", () => {
  it("a Skill one chat saves, another chat on the canvas lists and reads", async () => {
    const skills = canvas()
    const writer = buildSkillTools({
      canvas: skills,
      chatId: "chat-a",
      app: appSkillSource(),
    })
    const coordinator = buildSkillTools({
      canvas: skills,
      chatId: "chat-b",
      app: appSkillSource("coordinator"),
    })

    expect(
      await run(writer, "save_skill", {
        scope: "canvas",
        name: "release-notes",
        content: skillMd(
          "release-notes",
          "Write release notes.",
          "Group by feature."
        ),
        files: [{ path: "examples/v1.md", content: "## v1" }],
      })
    ).toBe(
      'Saved the canvas skill "release-notes". Every chat on this canvas can use it from its next turn.'
    )

    const read = await run(coordinator, "read_skill", { name: "release-notes" })
    expect(read).toContain("Group by feature.")
    expect(read).toContain("This skill’s file `examples/v1.md`:\n\n## v1")
    expect(await skills.list()).toMatchObject([
      { name: "release-notes", addedById: "chat-a" },
    ])
  })

  it("resolves Repo, then Canvas, then App Skills of the same name", async () => {
    const skills = canvas()
    for (const name of ["deploy", "screenplay-add-knob"]) {
      await skills.save({
        name,
        content: skillMd(name, "Canvas.", `CANVAS ${name}`),
        author: { addedBy: "agent", addedById: "chat-a" },
      })
    }
    const tools = buildSkillTools({
      canvas: skills,
      chatId: "chat-a",
      app: appSkillSource(),
      repo: async () =>
        repoFs({ deploy: skillMd("deploy", "Repo.", "REPO deploy") }),
    })

    expect(await run(tools, "read_skill", { name: "deploy" })).toContain(
      "REPO deploy"
    )
    expect(
      await run(tools, "read_skill", { name: "screenplay-add-knob" })
    ).toContain("CANVAS screenplay-add-knob")
    expect(
      await run(tools, "read_skill", { name: "screenplay-share-state" })
    ).toContain("name: screenplay-share-state")
  })

  it("lists the merged set for an unknown name, each name once", async () => {
    const skills = canvas()
    await skills.save({
      name: "review",
      content: skillMd("review", "Canvas review."),
      author: { addedBy: "agent", addedById: "chat-a" },
    })
    const tools = buildSkillTools({
      canvas: skills,
      chatId: "chat-a",
      app: appSkillSource(),
      repo: async () => repoFs({ review: skillMd("review", "Repo review.") }),
    })

    const out = await run(tools, "read_skill", { name: "nope" })
    expect(out).toContain('Unknown skill: "nope"')
    expect(out).toContain("- review: Repo review.")
    expect(out).not.toContain("Canvas review.")
    expect(out).toContain("- screenplay-add-knob:")
  })

  it("reads the desktop agent’s own Skills below the canvas’s (#1560)", async () => {
    const skills = canvas()
    await skills.save({
      name: "review",
      content: skillMd("review", "Canvas.", "CANVAS review"),
      author: { addedBy: "agent", addedById: "chat-a" },
    })
    const own: Record<string, string> = {
      review: skillMd("review", "Mine.", "MINE review"),
      tidy: skillMd("tidy", "Tidy up.", "MINE tidy"),
      "screenplay-add-knob": skillMd(
        "screenplay-add-knob",
        "Mine.",
        "MINE knob"
      ),
    }
    const tools = buildSkillTools({
      canvas: skills,
      chatId: "chat-a",
      app: appSkillSource(),
      agent: {
        agentName: "Claude Code",
        index: async () =>
          Object.keys(own).map((name) => ({ name, description: "Mine." })),
        read: async (name) => own[name] ?? null,
      },
    })

    expect(await run(tools, "read_skill", { name: "tidy" })).toContain(
      "MINE tidy"
    )
    expect(await run(tools, "read_skill", { name: "review" })).toContain(
      "CANVAS review"
    )
    expect(
      await run(tools, "read_skill", { name: "screenplay-add-knob" })
    ).toContain("MINE knob")
    expect(await run(tools, "read_skill", { name: "nope" })).toContain(
      "- tidy: Mine."
    )
  })

  it("falls through to the canvas and App Skills when the sandbox is unreachable", async () => {
    const tools = buildSkillTools({
      canvas: canvas(),
      chatId: "chat-a",
      app: appSkillSource(),
      repo: async () => null,
    })

    expect(
      await run(tools, "read_skill", { name: "screenplay-add-knob" })
    ).toContain("name: screenplay-add-knob")
  })

  it("gives the Coordinator only its own App Skills (#905)", async () => {
    const tools = buildSkillTools({
      canvas: canvas(),
      chatId: "coord",
      app: appSkillSource("coordinator"),
    })

    expect(
      await run(tools, "read_skill", { name: "screenplay-try-variants" })
    ).toContain("create_workspaces")
    const out = await run(tools, "read_skill", { name: "screenplay-add-knob" })
    expect(out).toContain('Unknown skill: "screenplay-add-knob"')
    expect(out).toContain("- screenplay-try-variants:")
    // Named in the description too, for a harness that lists tools first.
    expect(tools.read_skill.description).toContain("screenplay-try-variants")
  })

  it("says what it stripped, and when the repository’s Skill wins in this chat", async () => {
    const tools = buildSkillTools({
      canvas: canvas(),
      chatId: "chat-a",
      app: appSkillSource(),
      repo: async () => repoFs({ deploy: skillMd("deploy", "Repo.") }),
    })

    const out = await run(tools, "save_skill", {
      name: "deploy",
      content:
        "---\nname: deploy\ndescription: Ship.\nallowed-tools: Bash\n---\n!`git status`\nShip it.",
    })
    expect(out).toContain('Saved the canvas skill "deploy"')
    expect(out).toContain(
      "Removed allowed-tools and !`command` lines: saved skills can’t grant tools or run commands."
    )
    expect(out).toContain(
      'This branch’s repository has a skill named "deploy" too, and in this chat the repository’s wins.'
    )
  })

  it("says when a saved copy takes the place of a Built in Skill", async () => {
    const tools = buildSkillTools({
      canvas: canvas(),
      account: canvas(),
      chatId: "chat-a",
      app: appSkillSource(),
    })
    const content = skillMd("screenplay-add-knob", "Mine.", "My knobs.")

    expect(
      await run(tools, "save_skill", { name: "screenplay-add-knob", content })
    ).toContain(
      'It takes the place of Screenplay’s own skill "screenplay-add-knob" on this canvas.'
    )
    expect(
      await run(tools, "read_skill", { name: "screenplay-add-knob" })
    ).toContain("My knobs.")
  })

  it("refuses an invalid Skill with the reason", async () => {
    const tools = buildSkillTools({
      canvas: canvas(),
      chatId: "chat-a",
      app: appSkillSource(),
    })

    expect(
      await run(tools, "save_skill", {
        name: "Release Notes",
        content: skillMd("Release Notes", "x"),
      })
    ).toMatch(/^Error: "Release Notes" isn’t a valid skill name/)
  })

  it("deletes a Skill, which no chat then reads", async () => {
    const skills = canvas()
    const tools = buildSkillTools({
      canvas: skills,
      chatId: "chat-a",
      app: appSkillSource(),
    })
    await run(tools, "save_skill", {
      name: "review",
      content: skillMd("review", "Review.", "BODY"),
    })

    expect(await run(tools, "delete_skill", { name: "review" })).toBe(
      'Deleted the canvas skill "review".'
    )
    expect(await run(tools, "read_skill", { name: "review" })).toContain(
      'Unknown skill: "review"'
    )
    expect(await run(tools, "delete_skill", { name: "review" })).toBe(
      'Error: No skill named "review".'
    )
  })
})
