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
vi.mock("@/lib/files", () => ({ canvasFiles: () => fx.files }))
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
  }
})

import {
  mockupRefSources,
  resolveMockupRefs,
  type MockupRefSources,
} from "./mockup-refs-server"

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

function appSkill(name: string, files: Record<string, string>) {
  for (const [path, content] of Object.entries({
    "SKILL.md": skillMd(name),
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
    html: "<p>A</p>",
    title: "A",
    width: 400,
    height: 300,
    ownerChatId: "chat-1",
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

describe("resolveMockupRefs", () => {
  const sources = (size: number): MockupRefSources => ({
    skill: {},
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
      skill: {},
      canvasFile: async () => {
        throw new Error("store down")
      },
    })
    expect(out).toEqual({ "files:a.png": null })
  })
})
