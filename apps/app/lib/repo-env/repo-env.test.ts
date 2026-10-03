import { beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"
import type { RoomDoc } from "@/lib/room-access"
import type { RepoData } from "@/lib/types"
import { getRoomCollections } from "@/lib/yjs/schema"

process.env.ENCRYPTION_KEY = "11".repeat(32)

// The KV store, in memory: what's at rest is what a test can inspect.
const kvRows = vi.hoisted(() => new Map<string, string>())
vi.mock("@/lib/kv", () => ({
  kv: {
    get: async (key: string) => kvRows.get(key) ?? null,
    set: async (key: string, value: string) => {
      kvRows.set(key, value)
      return "OK"
    },
    del: async (key: string) => {
      kvRows.delete(key)
    },
  },
}))

// Room Access, scripted per test: who's asking, and the Canvas they open.
const access = vi.hoisted(() => ({
  userId: "ada",
  role: "editor" as "owner" | "editor" | "viewer",
  member: true,
  room: null as RoomDoc | null,
}))
vi.mock("@/lib/room-access", () => ({
  openRoom: async (roomId: string) => {
    if (!access.member) throw new Error("You don't have access to this canvas.")
    return {
      ...access.room!,
      roomId,
      userId: access.userId,
      role: access.role,
    }
  },
}))
vi.mock("@/lib/local-mode", () => ({ isLocalBuild: false }))

import {
  migrateCanvasEnv,
  revealCanvasRepoEnv,
  saveCanvasRepoEnv,
} from "./actions"
import { migrateCanvasRepoEnv } from "./migrate"
import { canRevealEnv, mergeEnvVars } from "./names"
import { envVarsDigest, kvCanvasRepoEnvStore } from "./store"

function repo(id: string, over: Partial<RepoData> = {}): RepoData {
  return {
    id,
    name: "",
    repoFullName: "acme/web",
    repoOwner: "acme",
    repoName: "web",
    defaultBranch: "main",
    cloneUrl: "",
    setupScript: "",
    devScript: "",
    devServerPort: 3000,
    createdAt: 0,
    ...over,
  }
}

function canvas(...repos: RepoData[]) {
  const doc = new Y.Doc()
  const c = getRoomCollections(doc)
  for (const r of repos) c.repos.set(r.id, r)
  const room: RoomDoc = {
    roomId: "room-1",
    readDoc: async (fn) => fn(c),
    mutateDoc: async (fn) => fn(c),
  }
  return { doc, c, room }
}

/** Everything the room doc holds, as one string to search. */
const docText = (doc: Y.Doc) => JSON.stringify(doc.toJSON())

beforeEach(() => {
  kvRows.clear()
  access.userId = "ada"
  access.role = "editor"
  access.member = true
  access.room = null
})

describe("Canvas env var storage", () => {
  it("round-trips values, encrypted at rest", async () => {
    await kvCanvasRepoEnvStore.set("room-1", "r1", "API_KEY=sk_live_secret")
    expect(await kvCanvasRepoEnvStore.get("room-1", "r1")).toBe(
      "API_KEY=sk_live_secret"
    )
    const [stored] = [...kvRows.values()]
    expect(stored).toBeDefined()
    expect(stored).not.toContain("sk_live_secret")
  })

  it("deletes the entry when every variable is cleared", async () => {
    await kvCanvasRepoEnvStore.set("room-1", "r1", "A=1")
    await kvCanvasRepoEnvStore.set("room-1", "r1", "")
    expect(kvRows.size).toBe(0)
    expect(await kvCanvasRepoEnvStore.get("room-1", "r1")).toBeNull()
  })

  it("digests what's set, not how it's written", () => {
    expect(envVarsDigest("A=1\nB=2")).toBe(envVarsDigest("# hi\nB=2\nA=1"))
    expect(envVarsDigest("A=1")).not.toBe(envVarsDigest("A=2"))
    expect(envVarsDigest("")).toBeUndefined()
  })
})

describe("mergeEnvVars", () => {
  it("replaces the typed variables and keeps the rest", () => {
    expect(mergeEnvVars("A=1\nB=2", "B=mine\nC=3")).toBe("A=1\nB=mine\nC=3")
  })
})

describe("canRevealEnv", () => {
  const viewer = { userId: "ada", isOwner: false, localBuild: false }

  it("is the adder's alone", () => {
    expect(canRevealEnv({ addedBy: "ada" }, viewer)).toBe(true)
    expect(canRevealEnv({ addedBy: "grace" }, viewer)).toBe(false)
    expect(
      canRevealEnv({ addedBy: "grace" }, { ...viewer, isOwner: true })
    ).toBe(false)
  })

  it("falls to the Canvas owner when nobody recorded an adder", () => {
    expect(canRevealEnv({}, viewer)).toBe(false)
    expect(canRevealEnv({}, { ...viewer, isOwner: true })).toBe(true)
  })

  it("is always the one person's on desktop", () => {
    expect(
      canRevealEnv({ addedBy: "grace" }, { ...viewer, localBuild: true })
    ).toBe(true)
  })
})

describe("migrateCanvasRepoEnv", () => {
  it("moves plain-text values out of the room doc into encrypted storage", async () => {
    const { doc, c, room } = canvas(
      repo("r1", { envVars: "API_KEY=sk_live_secret\nPORT=3000" }),
      repo("r2", { envVars: "" }),
      repo("r3")
    )

    expect(await migrateCanvasRepoEnv(room, kvCanvasRepoEnvStore)).toBe(2)

    expect(docText(doc)).not.toContain("sk_live_secret")
    expect(c.repos.get("r1")).not.toHaveProperty("envVars")
    expect(c.repos.get("r1")).toMatchObject({
      envVarNames: ["API_KEY", "PORT"],
      envVarsDigest: envVarsDigest("API_KEY=sk_live_secret\nPORT=3000"),
    })
    expect(c.repos.get("r2")).not.toHaveProperty("envVars")
    expect(c.repos.get("r2")?.envVarNames).toBeUndefined()
    expect(await kvCanvasRepoEnvStore.get("room-1", "r1")).toBe(
      "API_KEY=sk_live_secret\nPORT=3000"
    )
    expect(await kvCanvasRepoEnvStore.get("room-1", "r2")).toBeNull()
  })

  it("does nothing the second time", async () => {
    const { room } = canvas(repo("r1", { envVars: "A=12345678" }))
    await migrateCanvasRepoEnv(room, kvCanvasRepoEnvStore)
    expect(await migrateCanvasRepoEnv(room, kvCanvasRepoEnvStore)).toBe(0)
  })

  it("keeps values saved since over the legacy copy", async () => {
    const { c, room } = canvas(repo("r1", { envVars: "A=old" }))
    await kvCanvasRepoEnvStore.set("room-1", "r1", "A=new")

    await migrateCanvasRepoEnv(room, kvCanvasRepoEnvStore)

    expect(await kvCanvasRepoEnvStore.get("room-1", "r1")).toBe("A=new")
    expect(c.repos.get("r1")?.envVarsDigest).toBe(envVarsDigest("A=new"))
  })
})

describe("the env var server actions", () => {
  it("save stores values and hands back names and digest, never values", async () => {
    access.room = canvas(repo("r1", { addedBy: "ada" })).room

    const fields = await saveCanvasRepoEnv(
      "room-1",
      "r1",
      "A=1\nB=2",
      "replace"
    )

    expect(fields).toEqual({
      envVarNames: ["A", "B"],
      envVarsDigest: envVarsDigest("A=1\nB=2"),
    })
    expect(await kvCanvasRepoEnvStore.get("room-1", "r1")).toBe("A=1\nB=2")
  })

  it("merge lays a member's typed values over the stored ones", async () => {
    access.room = canvas(repo("r1", { addedBy: "grace" })).room
    await kvCanvasRepoEnvStore.set("room-1", "r1", "A=1\nB=2")

    await saveCanvasRepoEnv("room-1", "r1", "B=mine", "merge")

    expect(await kvCanvasRepoEnvStore.get("room-1", "r1")).toBe("A=1\nB=mine")
  })

  it("replace is refused for a member who can't reveal, and nothing changes", async () => {
    access.room = canvas(repo("r1", { addedBy: "grace" })).room
    await kvCanvasRepoEnvStore.set("room-1", "r1", "A=1\nB=2")

    await expect(
      saveCanvasRepoEnv("room-1", "r1", "", "replace")
    ).rejects.toThrow(
      "Only the person who added this repository can replace its values"
    )
    await expect(
      saveCanvasRepoEnv("room-1", "r1", "A=mine", "replace")
    ).rejects.toThrow()
    access.role = "owner"
    await expect(
      saveCanvasRepoEnv("room-1", "r1", "A=mine", "replace")
    ).rejects.toThrow()

    expect(await kvCanvasRepoEnvStore.get("room-1", "r1")).toBe("A=1\nB=2")
  })

  it("the adder can replace, and the owner when there's no adder", async () => {
    access.room = canvas(repo("r1", { addedBy: "grace" })).room
    await kvCanvasRepoEnvStore.set("room-1", "r1", "A=1\nB=2")
    access.userId = "grace"
    await saveCanvasRepoEnv("room-1", "r1", "C=3", "replace")
    expect(await kvCanvasRepoEnvStore.get("room-1", "r1")).toBe("C=3")

    access.room = canvas(repo("r2")).room
    await kvCanvasRepoEnvStore.set("room-1", "r2", "A=1")
    access.userId = "ada"
    access.role = "owner"
    await saveCanvasRepoEnv("room-1", "r2", "D=4", "replace")
    expect(await kvCanvasRepoEnvStore.get("room-1", "r2")).toBe("D=4")
  })

  it("a just-added repository not yet in the room doc saves while nothing is stored", async () => {
    access.room = canvas().room

    await saveCanvasRepoEnv("room-1", "r1", "A=1", "replace")
    expect(await kvCanvasRepoEnvStore.get("room-1", "r1")).toBe("A=1")

    await expect(
      saveCanvasRepoEnv("room-1", "r1", "", "replace")
    ).rejects.toThrow()
    expect(await kvCanvasRepoEnvStore.get("room-1", "r1")).toBe("A=1")
  })

  it("non-members and viewers can't save", async () => {
    access.room = canvas(repo("r1")).room
    access.member = false
    await expect(
      saveCanvasRepoEnv("room-1", "r1", "A=1", "replace")
    ).rejects.toThrow()
    access.member = true
    access.role = "viewer"
    await expect(
      saveCanvasRepoEnv("room-1", "r1", "A=1", "replace")
    ).rejects.toThrow()
    expect(kvRows.size).toBe(0)
  })

  it("only the adder can reveal", async () => {
    access.room = canvas(repo("r1", { addedBy: "grace" })).room
    await kvCanvasRepoEnvStore.set("room-1", "r1", "A=1")

    await expect(revealCanvasRepoEnv("room-1", "r1")).rejects.toThrow(
      "Only the person who added this repository can see its values"
    )
    access.role = "owner"
    await expect(revealCanvasRepoEnv("room-1", "r1")).rejects.toThrow()

    access.userId = "grace"
    access.role = "editor"
    expect(await revealCanvasRepoEnv("room-1", "r1")).toBe("A=1")
  })

  it("migrates the Canvas it's asked to, for a member", async () => {
    const { doc, room } = canvas(repo("r1", { envVars: "A=sk_live_secret" }))
    access.room = room
    await migrateCanvasEnv("room-1")
    expect(docText(doc)).not.toContain("sk_live_secret")
  })
})
