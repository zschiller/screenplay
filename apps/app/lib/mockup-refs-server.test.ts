import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"

import { beforeEach, describe, expect, it, vi } from "vitest"

import { createFiles, memoryFileIndex, type Files } from "@/lib/files/files"
import { memoryFileStore } from "@/lib/files/store"
import { MAX_MOCKUP_REF_BYTES, MAX_MOCKUP_REFS } from "@/lib/mockup-refs"
import type { RoomDoc } from "@/lib/room-access"
import type { RepoSkillFs } from "@/lib/skills/repo-skills"
import { createSavedSkills, type SavedSkills } from "@/lib/skills/saved"
import { baseBranch, baseChat, makeHarness } from "@/test/canvas/harness"

// The stores the sources read, as in-memory fakes the test fills.
const fx = vi.hoisted(() => ({
  canvas: null as SavedSkills | null,
  account: new Map<string, SavedSkills>(),
  files: null as Files | null,
  repo: null as RepoSkillFs | null,
  appDir: "",
}))
vi.mock("@/lib/skills/canvas", () => ({ canvasSkills: () => fx.canvas }))
vi.mock("@/lib/skills/account", () => ({
  accountSkills: (userId: string) => fx.account.get(userId),
}))
vi.mock("@/lib/files", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/files")>()),
  canvasFiles: () => fx.files,
}))
vi.mock("@/lib/skills/sandbox-index", () => ({
  repoSkillFsForSandbox: async () => fx.repo,
}))
vi.mock("@/lib/skills", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/skills")>()
  return {
    ...real,
    get appSkills() {
      return real.loadAppSkills(fx.appDir)
    },
    appSkillSource: (audience?: "workspace" | "coordinator") =>
      real.loadAppSkills(fx.appDir).source(audience),
    getSkillIndex: (audience?: "workspace" | "coordinator") =>
      real.loadAppSkills(fx.appDir).index(audience),
    getSkill: (name: string, audience?: "workspace" | "coordinator") =>
      real.loadAppSkills(fx.appDir).read(name, audience),
    openSkill: (name: string, audience?: "workspace" | "coordinator") =>
      real.loadAppSkills(fx.appDir).open(name, audience),
  }
})

import {
  mockupRefSources,
  resolveMockupRefs,
  type MockupRefSources,
} from "./mockup-refs-server"
import type { ChatTools } from "@/lib/agent/toolset"
import { roomChatTarget } from "@/lib/agent/room-chat-target"
import { sketchChatTarget } from "@/lib/agent/sketch-chat-target"
import { workspaceChatTarget } from "@/lib/agent/workspace-chat-target"
import { roomChatId } from "@/lib/chat/room-chat"
import { sketchChatSession } from "@/lib/chat/sketch-chat"

const agent = { addedBy: "agent" as const, addedById: "chat-1" }
const skillMd = (name: string) =>
  `---\nname: ${name}\ndescription: A template.\n---\nUse it.`
const text = (b64: string) => Buffer.from(b64, "base64").toString()

function savedSkills(): SavedSkills {
  return createSavedSkills({
    index: memoryFileIndex(),
    store: memoryFileStore(),
    keyPrefix: "skills",
  })
}

async function save(
  skills: SavedSkills,
  name: string,
  files: Record<string, string>
) {
  await skills.save({
    name,
    content: skillMd(name),
    files: Object.entries(files).map(([path, content]) => ({ path, content })),
    author: agent,
  })
}

function appSkill(
  name: string,
  files: Record<string, string>,
  audience?: "coordinator"
) {
  const md = audience
    ? skillMd(name).replace("\n---", `\naudience: ${audience}\n---`)
    : skillMd(name)
  for (const [path, content] of Object.entries({
    "SKILL.md": md,
    ...files,
  })) {
    const full = join(fx.appDir, name, path)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
}

/** A canvas with Mockup `m-1`, made by a chat in Workspace `ws-1`. */
function room(workspace: "running" | "stopped" = "running"): RoomDoc {
  const h = makeHarness()
  h.collections.branches.set("ws-1", baseBranch("ws-1", { status: workspace }))
  h.collections.chatSessions.set(
    "chat-1",
    baseChat("chat-1", { branchId: "ws-1" })
  )
  h.ops.createMockup({
    id: "m-1",
    title: "A",
    width: 400,
    height: 300,
    lastChangedByChatId: "chat-1",
  })
  return {
    roomId: "room-1",
    readDoc: async (fn) => fn(h.collections),
    mutateDoc: async (fn) => fn(h.collections),
  }
}

beforeEach(() => {
  fx.canvas = savedSkills()
  fx.account = new Map([["user-1", savedSkills()]])
  fx.files = createFiles({
    index: memoryFileIndex(),
    store: memoryFileStore(),
    keyPrefix: "canvas/room-1",
  })
  fx.repo = null
  fx.appDir = mkdtempSync(join(tmpdir(), "app-skills-"))
})

describe("a Mockup's references on a canvas", () => {
  const resolve = async (
    refs: string[],
    opts: { userId?: string; workspace?: "running" | "stopped" } = {}
  ) =>
    resolveMockupRefs(
      refs,
      await mockupRefSources(room(opts.workspace), {
        mockupId: "m-1",
        userId: opts.userId,
      })
    )

  it("reads a file of an App Skill", async () => {
    appSkill("explore", { "template/runtime.js": "app()" })
    const out = await resolve(["skill:explore/template/runtime.js"])
    expect(out["skill:explore/template/runtime.js"]).toMatchObject({
      type: "text/javascript",
    })
    expect(text(out["skill:explore/template/runtime.js"]!.data)).toBe("app()")
  })

  it("takes the Skill from the first source that has it: repo, canvas, account, App", async () => {
    appSkill("explore", { "a.css": "app", "b.css": "app", "c.css": "app" })
    await save(fx.account.get("user-1")!, "explore", {
      "a.css": "account",
      "b.css": "account",
    })
    await save(fx.canvas!, "explore", { "a.css": "canvas" })
    const out = await resolve(["skill:explore/a.css"], { userId: "user-1" })
    expect(text(out["skill:explore/a.css"]!.data)).toBe("canvas")

    // The winning Skill has no such file: it doesn't come from a lower one.
    const missing = await resolve(
      ["skill:explore/b.css", "skill:explore/c.css"],
      {
        userId: "user-1",
      }
    )
    expect(missing).toEqual({
      "skill:explore/b.css": null,
      "skill:explore/c.css": null,
    })
  })

  it("reads the viewer's Account Skills, and none without a viewer", async () => {
    appSkill("explore", { "a.css": "app" })
    await save(fx.account.get("user-1")!, "explore", { "a.css": "account" })
    const viewer = await resolve(["skill:explore/a.css"], { userId: "user-1" })
    expect(text(viewer["skill:explore/a.css"]!.data)).toBe("account")
    const nobody = await resolve(["skill:explore/a.css"])
    expect(text(nobody["skill:explore/a.css"]!.data)).toBe("app")
  })

  it("reads a Repo Skill from the Workspace of the chat that made the Mockup, while it runs", async () => {
    await save(fx.canvas!, "explore", { "a.css": "canvas" })
    const files: Record<string, string> = {
      ".claude/skills/explore/SKILL.md": skillMd("explore"),
      ".claude/skills/explore/a.css": "repo",
    }
    fx.repo = { list: async () => null, read: async (p) => files[p] ?? null }
    const running = await resolve(["skill:explore/a.css"])
    expect(text(running["skill:explore/a.css"]!.data)).toBe("repo")
    const stopped = await resolve(["skill:explore/a.css"], {
      workspace: "stopped",
    })
    expect(text(stopped["skill:explore/a.css"]!.data)).toBe("canvas")
  })

  it("reads a canvas File with its media type", async () => {
    await fx.files!.save({
      path: "shots/home.png",
      bytes: new Uint8Array([137, 80, 78, 71]),
      mediaType: "image/png",
      fallbackMediaType: "image/png",
      author: agent,
    })
    const out = await resolve(["files:shots/home.png", "files:shots/gone.png"])
    expect(out).toEqual({
      "files:shots/home.png": { type: "image/png", data: "iVBORw==" },
      "files:shots/gone.png": null,
    })
  })

  it("leaves an unknown Skill or a malformed reference unresolved", async () => {
    expect(
      await resolve(["skill:nobody/a.js", "skill:../x", "files:../x"])
    ).toEqual({
      "skill:nobody/a.js": null,
      "skill:../x": null,
      "files:../x": null,
    })
  })
})

describe("a chat's `read_skill` and its Mockup's `skill:` references (#1664)", () => {
  /** What `read_skill` shows of a Skill's `file`, or null. */
  async function shownFile(tools: ChatTools, name: string, file: string) {
    const execute = tools.shared.read_skill!.execute as (
      input: object,
      options: object
    ) => Promise<string>
    const out = await execute({ name }, { toolCallId: "t", messages: [] })
    const m = out.match(new RegExp(`This skill’s file \`${file}\`:\\n\\n(.*)`))
    return m ? m[1]! : null
  }

  /** A canvas with Mockup `m-1`, made by `chatId`. */
  function madeBy(chatId: string): RoomDoc {
    const r = room()
    void r.mutateDoc((c) => {
      c.chatSessions.set("chat-s", sketchChatSession("chat-s", 1))
      c.mockupLayers.update("m-1", { lastChangedByChatId: chatId })
    })
    return r
  }

  it("resolve the same Skill for every kind of chat", async () => {
    appSkill("screenplay-add-knob", { "k.js": "app knob" })
    appSkill("screenplay-explore", { "e.js": "app explore" })
    appSkill("screenplay-try", { "t.js": "app try" }, "coordinator")
    await save(fx.canvas!, "review", { "r.js": "canvas review" })

    const kinds: Array<[string, string, (r: RoomDoc) => ChatTools]> = [
      [
        "a Workspace chat",
        "chat-1",
        (r) =>
          workspaceChatTarget.tools(r, {
            sandboxName: "ws-1",
            chatId: "chat-1",
            userId: "user-1",
          }),
      ],
      [
        "a sketch chat",
        "chat-s",
        (r) =>
          sketchChatTarget.tools(r, { chatId: "chat-s", userId: "user-1" }),
      ],
      [
        "the Coordinator",
        roomChatId("room-1"),
        (r) => roomChatTarget.tools(r, { userId: "user-1" }),
      ],
    ]
    const skills: Array<[string, string]> = [
      ["screenplay-add-knob", "k.js"],
      ["screenplay-explore", "e.js"],
      ["screenplay-try", "t.js"],
      ["review", "r.js"],
    ]
    const seen: Record<string, string[]> = {}
    for (const [kind, chatId, tools] of kinds) {
      const r = madeBy(chatId)
      const sources = await mockupRefSources(r, {
        mockupId: "m-1",
        userId: "user-1",
      })
      for (const [name, file] of skills) {
        const ref = `skill:${name}/${file}`
        const resolved = (await resolveMockupRefs([ref], sources))[ref]
        const fromRef = resolved ? text(resolved.data) : null
        expect(fromRef, `${kind}: ${ref}`).toBe(
          await shownFile(tools(r), name, file)
        )
        if (fromRef) (seen[kind] ??= []).push(name)
      }
    }
    // Each kind sees its own App Skills, and every kind the canvas's.
    expect(seen).toEqual({
      "a Workspace chat": [
        "screenplay-add-knob",
        "screenplay-explore",
        "review",
      ],
      "a sketch chat": ["screenplay-add-knob", "review"],
      "the Coordinator": ["screenplay-try", "review"],
    })
  })
})

describe("resolveMockupRefs", () => {
  const sources = (size: number): MockupRefSources => ({
    skillFile: async () => null,
    canvasFile: async () => ({
      type: "image/png",
      bytes: new Uint8Array(size),
    }),
  })

  it(`resolves at most ${MAX_MOCKUP_REFS} references`, async () => {
    const refs = Array.from(
      { length: MAX_MOCKUP_REFS + 1 },
      (_, i) => `files:${i}.png`
    )
    const out = await resolveMockupRefs(refs, sources(1))
    expect(out[`files:${MAX_MOCKUP_REFS - 1}.png`]).not.toBeNull()
    expect(out[`files:${MAX_MOCKUP_REFS}.png`]).toBeNull()
  })

  it("stops resolving past the page's byte budget", async () => {
    const half = MAX_MOCKUP_REF_BYTES / 2
    const out = await resolveMockupRefs(
      ["files:a.png", "files:b.png", "files:c.png"],
      sources(half)
    )
    expect(out["files:a.png"]).not.toBeNull()
    expect(out["files:b.png"]).not.toBeNull()
    expect(out["files:c.png"]).toBeNull()
  })

  it("treats a source that fails as unresolved", async () => {
    const out = await resolveMockupRefs(["files:a.png"], {
      skillFile: async () => null,
      canvasFile: async () => {
        throw new Error("store down")
      },
    })
    expect(out).toEqual({ "files:a.png": null })
  })
})
