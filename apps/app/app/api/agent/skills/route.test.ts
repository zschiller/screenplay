import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

import { makeHarness } from "@/test/canvas/harness"
import type { RoomCollections } from "@/lib/yjs/schema"

/**
 * The `/`-menu Skill route (#1555): a member's request for a canvas lists its
 * saved Skills among the App Skills; anyone else gets the room's refusal.
 */

vi.mock("@/lib/auth-helpers", () => ({ getUserId: async () => "user-1" }))
let collections: RoomCollections
vi.mock("@/lib/room-access", () => ({
  openRoomForRoute: async (roomId: string) =>
    roomId === "room-1"
      ? {
          roomId,
          readDoc: async <T>(fn: (c: RoomCollections) => T) => fn(collections),
          mutateDoc: async <T>(fn: (c: RoomCollections) => T) =>
            fn(collections),
        }
      : new Response("Not a member", { status: 403 }),
}))

// The desktop build, whose chats run on the user's own coding agent (#1560).
const desktop = vi.hoisted(() => ({ isLocalBuild: false, home: "" }))
vi.mock("@/lib/local-mode", () => ({
  get isLocalBuild() {
    return desktop.isLocalBuild
  },
}))
vi.mock("node:os", async (original) => {
  const os = await original<typeof import("node:os")>()
  return { ...os, homedir: () => desktop.home || os.homedir() }
})

// The asker's Account Skills (#1558), in memory instead of the KV.
const accountSkills = vi.hoisted(() => ({
  entries: [] as import("@/lib/types").FileEntryData[],
}))
vi.mock("@/lib/files/account-store", () => ({
  kvAccountSkillStore: (userId: string) => ({
    load: async () => (userId === "user-1" ? accountSkills.entries : []),
    save: async () => {},
  }),
}))

import { GET } from "./route"

function folder(path: string, description?: string) {
  return {
    id: `f-${path}`,
    path,
    kind: "folder" as const,
    size: 0,
    mediaType: "",
    addedBy: "agent" as const,
    addedById: "chat-1",
    blobKey: "",
    createdAt: 1,
    updatedAt: 1,
    ...(description === undefined ? {} : { description }),
  }
}

describe("GET /api/agent/skills", () => {
  it("lists a canvas's saved Skills, shadowing an App Skill of the same name", async () => {
    collections = makeHarness().collections
    collections.skills.set("f-review", folder("review", "Review a PR."))
    collections.skills.set(
      "f-knob",
      folder("screenplay-add-knob", "Canvas knob.")
    )

    const res = await GET(
      new Request("http://localhost/api/agent/skills?room=room-1")
    )
    const { skills } = await res.json()

    expect(skills).toContainEqual({
      name: "review",
      description: "Review a PR.",
      origin: "canvas",
    })
    expect(
      skills.filter((s: { name: string }) => s.name === "screenplay-add-knob")
    ).toEqual([
      {
        name: "screenplay-add-knob",
        description: "Canvas knob.",
        origin: "canvas",
      },
    ])
  })

  it("refuses a canvas the asker isn't a member of", async () => {
    const res = await GET(
      new Request("http://localhost/api/agent/skills?room=room-2")
    )
    expect(res.status).toBe(403)
  })

  it("lists the Coordinator's App Skills and the canvas's in a Coordinator chat (#1556)", async () => {
    collections = makeHarness().collections
    collections.skills.set("f-review", folder("review", "Review a PR."))

    const res = await GET(
      new Request(
        "http://localhost/api/agent/skills?room=room-1&chat=room&sandbox=sbx-1"
      )
    )
    const { skills } = await res.json()

    expect(skills.map((s: { name: string }) => s.name)).toEqual([
      "review",
      "screenplay-try-variants",
    ])
    expect(skills.map((s: { origin: string }) => s.origin)).toEqual([
      "canvas",
      "app",
    ])
  })

  it("lists the Mockup App Skills and the canvas's in a sketch chat", async () => {
    collections = makeHarness().collections
    collections.skills.set("f-review", folder("review", "Review a PR."))

    const res = await GET(
      new Request("http://localhost/api/agent/skills?room=room-1&chat=sketch")
    )
    const { skills } = await res.json()

    expect(skills.map((s: { name: string }) => s.name)).toEqual([
      "review",
      "screenplay-add-knob",
      "screenplay-share-state",
    ])
  })

  it("lists App Skills only with no canvas or sandbox", async () => {
    const res = await GET(new Request("http://localhost/api/agent/skills"))
    const { skills } = await res.json()
    expect(skills.length).toBeGreaterThan(0)
    expect(skills.every((s: { origin: string }) => s.origin === "app")).toBe(
      true
    )
  })

  it("lists the desktop agent's own Skills by its name, below the canvas's (#1560)", async () => {
    desktop.home = await mkdtemp(join(tmpdir(), "skills-route-"))
    const own = async (name: string) => {
      await mkdir(join(desktop.home, ".claude/skills", name), {
        recursive: true,
      })
      await writeFile(
        join(desktop.home, ".claude/skills", name, "SKILL.md"),
        `---\nname: ${name}\ndescription: Mine.\n---\n`
      )
    }
    await own("tidy")
    await own("review")
    collections = makeHarness().collections
    collections.skills.set("f-review", folder("review", "Review a PR."))
    const url =
      "http://localhost/api/agent/skills?room=room-1&chat=sketch&model=harness:claude-code:opus"
    const sources = async () => {
      const { skills } = await (await GET(new Request(url))).json()
      return skills.filter((s: { name: string }) =>
        ["tidy", "review"].includes(s.name)
      )
    }

    try {
      // Hosted: no coding agent of the user's own.
      expect(await sources()).toEqual([
        { name: "review", description: "Review a PR.", origin: "canvas" },
      ])

      desktop.isLocalBuild = true
      vi.stubEnv("AGENT_ENGINE", "external")
      expect(await sources()).toEqual([
        { name: "review", description: "Review a PR.", origin: "canvas" },
        {
          name: "tidy",
          description: "Mine.",
          origin: "agent",
          agentName: "Claude Code",
        },
      ])
    } finally {
      desktop.isLocalBuild = false
      vi.unstubAllEnvs()
      await rm(desktop.home, { recursive: true, force: true })
      desktop.home = ""
    }
  })

  it("lists your Account Skills below the canvas's in every kind of chat (#1558)", async () => {
    collections = makeHarness().collections
    collections.skills.set("f-review", folder("review", "Review a PR."))
    accountSkills.entries = [
      folder("review", "My review."),
      folder("voice", "My voice."),
    ]
    try {
      for (const query of [
        "room=room-1",
        "room=room-1&chat=room",
        "room=room-1&chat=sketch",
      ]) {
        const { skills } = await (
          await GET(new Request(`http://localhost/api/agent/skills?${query}`))
        ).json()
        expect(
          skills.filter((s: { name: string }) =>
            ["review", "voice"].includes(s.name)
          )
        ).toEqual([
          { name: "review", description: "Review a PR.", origin: "canvas" },
          { name: "voice", description: "My voice.", origin: "account" },
        ])
      }
    } finally {
      accountSkills.entries = []
    }
  })
})
