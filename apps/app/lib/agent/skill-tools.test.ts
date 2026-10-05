import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { describe, expect, it } from "vitest"

import {
  buildSkillTools as buildToolsOver,
  type SkillToolContext,
} from "@/lib/agent/skill-tools"
import { skillSources, type SkillSourceInputs } from "@/lib/skills/sources"
import { memoryFileIndex } from "@/lib/files/files"
import { memoryFileStore } from "@/lib/files/store"
import { appSkillSource, loadAppSkills } from "@/lib/skills"
import type { RepoSkillFs } from "@/lib/skills/repo-skills"
import {
  createSavedSkills,
  SKILL_MAX_BYTES,
  type SavedSkills,
} from "@/lib/skills/saved"

/** The Skill tools over Skill Sources built from `ctx`, as a Chat Target builds them. */
function buildSkillTools(
  ctx: Omit<SkillToolContext, "skills"> & SkillSourceInputs
) {
  const { canvas, account, chatId, appSkillSet, ...sources } = ctx
  return buildToolsOver({
    skills: skillSources({ canvas, account, ...sources }),
    canvas,
    account,
    chatId,
    appSkillSet,
  })
}

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
  it("a Skill saved on the canvas, another chat on the canvas lists and reads", async () => {
    const skills = canvas()
    const coordinator = buildSkillTools({
      canvas: skills,
      chatId: "chat-b",
      app: appSkillSource("coordinator"),
    })

    await skills.save({
      name: "release-notes",
      content: skillMd(
        "release-notes",
        "Write release notes.",
        "Group by feature."
      ),
      files: [{ path: "examples/v1.md", content: "## v1" }],
      author: { addedBy: "agent", addedById: "chat-a" },
    })

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
        file: async () => undefined,
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
    const skills = canvas()
    const tools = buildSkillTools({
      canvas: skills,
      chatId: "chat-a",
      app: appSkillSource(),
      repo: async () => repoFs({ deploy: skillMd("deploy", "Repo.") }),
    })

    const out = await run(tools, "save_skill", {
      name: "deploy",
      content:
        "---\nname: deploy\ndescription: Ship.\nallowed-tools: Bash\n---\n!`git status`\nShip it.",
    })
    expect(out).toContain(
      'Showed "deploy" to the person as a card with Save to account and Save to canvas.'
    )
    expect(out).toContain(
      "Saving removes allowed-tools and !`command` lines: saved skills can’t grant tools or run commands."
    )
    expect(out).toContain(
      'This branch’s repository has a skill named "deploy" too, and in this chat the repository’s wins.'
    )
    expect(await skills.list()).toEqual([])
  })

  it("says when a saved copy takes the place of a Built in Skill", async () => {
    const skills = canvas()
    const account = canvas()
    const tools = buildSkillTools({
      canvas: skills,
      account,
      chatId: "chat-a",
      app: appSkillSource(),
    })
    const content = skillMd("screenplay-add-knob", "Mine.", "My knobs.")

    expect(
      await run(tools, "save_skill", { name: "screenplay-add-knob", content })
    ).toContain(
      'Once saved, it takes the place of Screenplay’s own skill "screenplay-add-knob".'
    )
    expect(await skills.list()).toEqual([])
    expect(await account.list()).toEqual([])
    expect(
      await run(tools, "read_skill", { name: "screenplay-add-knob" })
    ).not.toContain("My knobs.")
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

  it("offers a valid Skill without saving it, and refuses an invalid one, saving nothing", async () => {
    const skills = canvas()
    const account = canvas()
    const tools = buildSkillTools({
      canvas: skills,
      account,
      chatId: "chat-a",
      app: appSkillSource(),
    })

    expect(
      await run(tools, "save_skill", {
        name: "review",
        content: "no frontmatter",
      })
    ).toMatch(/^Error: /)
    expect(
      await run(tools, "save_skill", {
        scope: "account",
        name: "review",
        content: skillMd("review", "Review.", "BODY"),
      })
    ).toBe(
      'Showed "review" to the person as a card with Save to account and Save to canvas. It’s saved only when they press one, and chats can use it from their next turn after that.'
    )
    expect(await skills.list()).toEqual([])
    expect(await account.list()).toEqual([])
  })

  it("deletes a Skill, which no chat then reads", async () => {
    const skills = canvas()
    const tools = buildSkillTools({
      canvas: skills,
      chatId: "chat-a",
      app: appSkillSource(),
    })
    await skills.save({
      name: "review",
      content: skillMd("review", "Review.", "BODY"),
      author: { addedBy: "agent", addedById: "chat-a" },
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

  describe("App Skills with supporting files (#1642)", () => {
    /** App Skills holding one design Skill with a page template beside it. */
    function appWithTemplate(template = "<main></main>") {
      const dir = mkdtempSync(join(tmpdir(), "app-skills-"))
      mkdirSync(join(dir, "screenplay-explore", "templates"), {
        recursive: true,
      })
      writeFileSync(
        join(dir, "screenplay-explore", "SKILL.md"),
        skillMd("screenplay-explore", "Explore a design.", "Fill the page.")
      )
      writeFileSync(
        join(dir, "screenplay-explore", "templates", "page.html"),
        template
      )
      return loadAppSkills(dir)
    }

    it("reads an App Skill’s files like a saved Skill’s", async () => {
      const set = appWithTemplate()
      const tools = buildSkillTools({
        canvas: canvas(),
        chatId: "chat-a",
        app: set.source(),
        appSkillSet: set,
      })

      const read = await run(tools, "read_skill", {
        name: "screenplay-explore",
      })
      expect(read).toContain("Fill the page.")
      expect(read).toContain(
        "This skill’s file `templates/page.html`:\n\n<main></main>"
      )
    })

    it("keeps an App Skill’s files in a copy that only changes SKILL.md", async () => {
      const set = appWithTemplate()
      const tools = buildSkillTools({
        canvas: canvas(),
        chatId: "chat-a",
        app: set.source(),
        appSkillSet: set,
      })

      const out = await run(tools, "save_skill", {
        name: "screenplay-explore",
        content: skillMd("screenplay-explore", "Mine.", "My way."),
      })
      expect(out).toContain(
        'takes the place of Screenplay’s own skill "screenplay-explore"'
      )
      expect(out).toContain(
        "It keeps `templates/page.html` from Screenplay’s own skill."
      )

      // A copy that passes its own template keeps nothing.
      expect(
        await run(tools, "save_skill", {
          name: "screenplay-explore",
          content: skillMd("screenplay-explore", "Mine."),
          files: [
            { path: "templates/page.html", content: "<main>mine</main>" },
          ],
        })
      ).not.toContain("It keeps")
    })

    it("counts the files a copy keeps toward the size cap", async () => {
      const set = appWithTemplate("x".repeat(SKILL_MAX_BYTES))
      const tools = buildSkillTools({
        canvas: canvas(),
        chatId: "chat-a",
        app: set.source(),
        appSkillSet: set,
      })

      expect(
        await run(tools, "save_skill", {
          name: "screenplay-explore",
          content: skillMd("screenplay-explore", "Mine."),
        })
      ).toContain("Error: The skill is")
    })
  })
})
