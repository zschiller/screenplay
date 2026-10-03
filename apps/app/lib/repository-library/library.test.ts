import { describe, expect, it, vi } from "vitest"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { RoomCollections } from "@/lib/yjs/schema"
import {
  baseBranch,
  baseChat,
  baseRepo,
  makeHarness,
} from "@/test/canvas/harness"
import {
  canvasRepositoryGroups,
  canvasRepositoryRows,
  createRepositoryLibrary,
  desktopLinkPolicy,
  hostedLinkPolicy,
  isCustomized,
  linkedRepo,
  resetToRepository,
  switchOff,
  switchOn,
  switchOnWithEnv,
  type CanvasRooms,
  type RepositoryLinkPolicy,
  type RepositoryStore,
} from "@/lib/repository-library"

function repository(
  id: string,
  overrides: Partial<RepoConfig> = {}
): RepoConfig {
  return {
    id,
    name: "",
    repoFullName: "acme/web",
    repoOwner: "acme",
    repoName: "web",
    defaultBranch: "main",
    cloneUrl: "https://github.com/acme/web.git",
    private: true,
    setupScript: "pnpm install",
    devScript: "pnpm dev",
    devServerPort: 3000,
    envVars: "",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

function memoryStore(initial: RepoConfig[] = []) {
  let list = initial
  let migrated = false
  const store: RepositoryStore = {
    load: async () => list,
    save: async (next) => {
      list = next
    },
    isMigrated: async () => migrated,
    markMigrated: async () => {
      migrated = true
    },
  }
  return store
}

/** A fake keyed digest: equal text, equal digest, and no value in it. */
const digest = (text: string) =>
  text.trim()
    ? `d:${[...text.trim()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)}`
    : undefined

/** Canvas env var values the library stored, as [canvas, repo, text]. */
function memoryEnv() {
  const sets: Array<[string, string, string]> = []
  return {
    sets,
    env: {
      set: async (roomId: string, repoId: string, text: string) => {
        sets.push([roomId, repoId, text])
      },
      digest,
    },
  }
}

function setup({
  repositories = [],
  canvases = {},
  policy = desktopLinkPolicy,
  userId = "zack",
  rooms,
}: {
  repositories?: RepoConfig[]
  canvases?: Record<string, ReturnType<typeof makeHarness>>
  policy?: RepositoryLinkPolicy
  userId?: string
  /** In place of the canvases' own rooms. */
  rooms?: CanvasRooms
} = {}) {
  let n = 0
  const store = memoryStore(repositories)
  const { env, sets } = memoryEnv()
  const library = createRepositoryLibrary({
    userId,
    store,
    env,
    policy,
    mint: () => ({ id: `new-${++n}`, now: 100 + n }),
    rooms: rooms ?? {
      list: async () => Object.keys(canvases),
      read: async (roomId, fn) => fn(canvases[roomId]!.collections),
      mutate: async (roomId, fn) => fn(canvases[roomId]!.collections),
    },
  })
  return { library, store, envSets: sets }
}

function canvasWith(...repos: ReturnType<typeof baseRepo>[]) {
  const canvas = makeHarness()
  for (const repo of repos) canvas.collections.repos.set(repo.id, repo)
  return canvas
}

const repoOf = (c: { collections: RoomCollections }, id: string) =>
  c.collections.repos.get(id)

describe("a person's repositories", () => {
  it("creates, updates and deletes", async () => {
    const { library } = setup()
    await library.save(repository("web"))
    await library.save(repository("web", { devScript: "pnpm start" }))
    expect(await library.list()).toEqual([
      repository("web", { devScript: "pnpm start" }),
    ])
    await library.delete("web")
    expect(await library.list()).toEqual([])
  })

  it("re-saving the same remote + name updates it in place", async () => {
    const { library } = setup({ repositories: [repository("web")] })
    const next = await library.save(
      repository("other-id", { devServerPort: 4000, createdAt: 9 })
    )
    expect(next).toEqual([
      repository("web", { devServerPort: 4000, createdAt: 1 }),
    ])
  })

  it("keeps the same GitHub repository as two repositories by name", async () => {
    const { library } = setup()
    await library.save(repository("a", { name: "web" }))
    await library.save(repository("b", { name: "api", devServerPort: 4000 }))
    expect((await library.list()).map((r) => r.name)).toEqual(["web", "api"])
  })
})

describe("switch on", () => {
  it("copies a repository into the canvas, linked and credited", () => {
    const canvas = makeHarness()
    const id = switchOn(canvas.collections, repository("web"), {
      id: "repo-1",
      createdAt: 5,
      addedBy: "zack",
    })
    expect(id).toBe("repo-1")
    expect(repoOf(canvas, "repo-1")).toMatchObject({
      repoFullName: "acme/web",
      setupScript: "pnpm install",
      devScript: "pnpm dev",
      devServerPort: 3000,
      repositoryId: "web",
      addedBy: "zack",
      createdAt: 5,
    })
  })

  it("does nothing when the repository is already on", () => {
    const canvas = makeHarness()
    const meta = { id: "repo-1", createdAt: 5, addedBy: "zack" }
    switchOn(canvas.collections, repository("web"), meta)
    const again = switchOn(canvas.collections, repository("web"), {
      ...meta,
      id: "repo-2",
    })
    expect(again).toBe("repo-1")
    expect(canvas.collections.repos.toArray()).toHaveLength(1)
  })

  const meta = { id: "repo-1", createdAt: 5, addedBy: "zack" }
  const storeEnv = (text: string) => ({
    envVarNames: text.split("\n").map((l) => l.split("=")[0]!),
    envVarsDigest: digest(text),
  })

  it("stores the env values before the canvas lists their names", async () => {
    const canvas = makeHarness()
    const web = repository("web", {
      envVars: "A=1\nB=2",
      envVarsDigest: digest("A=1\nB=2"),
    })
    const saveEnv = vi.fn(async (repoId: string, text: string) => {
      expect(repoOf(canvas, repoId)).toBeUndefined()
      return storeEnv(text)
    })

    const id = await switchOnWithEnv(canvas.collections, web, meta, saveEnv)

    expect(saveEnv).toHaveBeenCalledWith("repo-1", "A=1\nB=2")
    expect(id).toBe("repo-1")
    expect(repoOf(canvas, "repo-1")).toMatchObject({
      envVarNames: ["A", "B"],
      envVarsDigest: digest("A=1\nB=2"),
      repositoryId: "web",
    })
  })

  it("leaves the repository off when the env values can't be stored", async () => {
    const canvas = makeHarness()
    const web = repository("web", { envVars: "A=1" })
    const saveEnv = vi.fn().mockRejectedValue(new Error("KV down"))

    await expect(
      switchOnWithEnv(canvas.collections, web, meta, saveEnv)
    ).rejects.toThrow("KV down")

    expect(canvas.collections.repos.toArray()).toHaveLength(0)
  })

  it("skips the store for a repository without env values", async () => {
    const canvas = makeHarness()
    const saveEnv = vi.fn()

    await switchOnWithEnv(canvas.collections, repository("web"), meta, saveEnv)

    expect(saveEnv).not.toHaveBeenCalled()
    expect(repoOf(canvas, "repo-1")?.envVarNames).toBeUndefined()
  })

  it("stores nothing when the repository is already on", async () => {
    const canvas = makeHarness()
    const web = repository("web", { envVars: "A=1" })
    switchOn(canvas.collections, web, meta)
    const saveEnv = vi.fn()

    const id = await switchOnWithEnv(
      canvas.collections,
      web,
      { ...meta, id: "repo-2" },
      saveEnv
    )

    expect(id).toBe("repo-1")
    expect(saveEnv).not.toHaveBeenCalled()
  })
})

describe("switch off", () => {
  it("removes the linked repo with its workspaces and chats", () => {
    const canvas = makeHarness()
    switchOn(canvas.collections, repository("web"), {
      id: "repo-1",
      createdAt: 5,
      addedBy: "zack",
    })
    canvas.collections.branches.set(
      "b1",
      baseBranch("b1", { repoId: "repo-1", sandboxName: "sb-1" })
    )
    canvas.collections.chatSessions.set(
      "c1",
      baseChat("c1", { branchId: "b1" })
    )

    const result = switchOff(canvas.collections, "web")

    expect(result).toEqual({
      repoId: "repo-1",
      sandboxNames: ["sb-1"],
      removedChatIds: ["c1"],
    })
    expect(linkedRepo(canvas.collections, "web")).toBeUndefined()
    expect(canvas.collections.branches.get("b1")).toBeUndefined()
    expect(canvas.collections.chatSessions.get("c1")).toBeUndefined()
  })

  it("does nothing when the repository isn't on", () => {
    const canvas = canvasWith(baseRepo("repo-1"))
    expect(switchOff(canvas.collections, "web").repoId).toBeNull()
    expect(repoOf(canvas, "repo-1")).toBeDefined()
  })
})

describe("the canvas repositories list", () => {
  const summary = (rows: ReturnType<typeof canvasRepositoryRows>) =>
    rows.map((row) =>
      row.on
        ? `on ${row.repo.id}${row.repository ? ` <- ${row.repository.id}` : ""}`
        : `off ${row.repository.id}`
    )

  it("lists every repository, on where the canvas links to it", () => {
    const canvas = makeHarness()
    const web = repository("web", { name: "web" })
    const api = repository("api", { name: "api" })
    switchOn(canvas.collections, web, {
      id: "repo-1",
      createdAt: 5,
      addedBy: "zack",
    })
    expect(
      summary(
        canvasRepositoryRows([web, api], canvas.collections.repos.toArray())
      )
    ).toEqual(["off api", "on repo-1 <- web"])
  })

  it("keeps canvas repos that link to none of yours, switched on", () => {
    const canvas = canvasWith(
      baseRepo("unlinked", { name: "docs" }),
      baseRepo("theirs", { name: "admin", repositoryId: "someone-elses" })
    )
    expect(
      summary(
        canvasRepositoryRows(
          [repository("web", { name: "web" })],
          canvas.collections.repos.toArray()
        )
      )
    ).toEqual(["on theirs", "on unlinked", "off web"])
  })

  it("leaves out yours when a teammate added the same repository", () => {
    const canvas = canvasWith(
      baseRepo("theirs", {
        name: "web",
        repoFullName: "acme/web",
        repositoryId: "someone-elses",
      })
    )
    const repos = canvas.collections.repos.toArray()
    expect(
      summary(canvasRepositoryRows([repository("web", { name: "web" })], repos))
    ).toEqual(["on theirs"])
    // Another name for the same remote is a different Repository.
    expect(
      summary(canvasRepositoryRows([repository("api", { name: "api" })], repos))
    ).toEqual(["off api", "on theirs"])
  })

  it("groups the canvas's repos before your others, leaving out empty groups", () => {
    const web = repository("web", { name: "web" })
    const api = repository("api", { name: "api" })
    const canvas = makeHarness()
    const rows = () =>
      canvasRepositoryRows([web, api], canvas.collections.repos.toArray())
    const labels = () => canvasRepositoryGroups(rows()).map((g) => g.label)
    expect(labels()).toEqual(["Your other repositories"])
    switchOn(canvas.collections, web, {
      id: "repo-1",
      createdAt: 5,
      addedBy: "zack",
    })
    expect(canvasRepositoryGroups(rows())).toEqual([
      { label: "On this canvas", rows: rows().filter((r) => r.on) },
      { label: "Your other repositories", rows: rows().filter((r) => !r.on) },
    ])
    switchOn(canvas.collections, api, {
      id: "repo-2",
      createdAt: 6,
      addedBy: "zack",
    })
    expect(labels()).toEqual(["On this canvas"])
  })

  it("flips a row on and off in place", () => {
    const canvas = makeHarness()
    const web = repository("web", { name: "web" })
    const rows = () =>
      summary(canvasRepositoryRows([web], canvas.collections.repos.toArray()))
    expect(rows()).toEqual(["off web"])
    switchOn(canvas.collections, web, {
      id: "repo-1",
      createdAt: 5,
      addedBy: "zack",
    })
    expect(rows()).toEqual(["on repo-1 <- web"])
    switchOff(canvas.collections, "web")
    expect(rows()).toEqual(["off web"])
  })
})

describe("migration", () => {
  it("links canvas repos to the repository with the same remote + name", async () => {
    const canvas = canvasWith(
      baseRepo("r1", { repoFullName: "acme/web", name: "" }),
      baseRepo("r2", { repoFullName: "acme/web", name: "api" })
    )
    const { library } = setup({
      repositories: [repository("web"), repository("api", { name: "api" })],
      canvases: { room: canvas },
    })

    await library.list()

    expect(repoOf(canvas, "r1")).toMatchObject({
      repositoryId: "web",
      addedBy: "zack",
    })
    expect(repoOf(canvas, "r2")).toMatchObject({
      repositoryId: "api",
      addedBy: "zack",
    })
  })

  it("on desktop, gives an unmatched canvas repo a repository of its own", async () => {
    const a = canvasWith(
      baseRepo("r1", {
        repoFullName: "acme/api",
        name: "",
        devScript: "go run .",
        localPath: "/code/api",
      })
    )
    const b = canvasWith(baseRepo("r2", { repoFullName: "acme/api", name: "" }))
    const { library } = setup({ canvases: { a, b } })

    const list = await library.list()

    expect(list).toEqual([
      expect.objectContaining({
        id: "new-1",
        repoFullName: "acme/api",
        name: "",
        devScript: "go run .",
        localPath: "/code/api",
      }),
    ])
    // The second Canvas links to the Repository the first one created.
    expect(repoOf(a, "r1")?.repositoryId).toBe("new-1")
    expect(repoOf(b, "r2")?.repositoryId).toBe("new-1")
  })

  it("on hosted, leaves an unmatched canvas repo unlinked with no adder", async () => {
    const canvas = canvasWith(baseRepo("r1", { repoFullName: "acme/api" }))
    const { library } = setup({
      canvases: { room: canvas },
      policy: hostedLinkPolicy,
    })

    expect(await library.list()).toEqual([])
    expect(repoOf(canvas, "r1")?.repositoryId).toBeUndefined()
    expect(repoOf(canvas, "r1")?.addedBy).toBeUndefined()
  })

  it("leaves repos already linked by someone else alone", async () => {
    const canvas = canvasWith(
      baseRepo("r1", {
        repoFullName: "acme/web",
        name: "",
        repositoryId: "theirs",
        addedBy: "sam",
      })
    )
    const { library } = setup({
      repositories: [repository("web")],
      canvases: { room: canvas },
      policy: hostedLinkPolicy,
    })

    await library.list()

    expect(repoOf(canvas, "r1")).toMatchObject({
      repositoryId: "theirs",
      addedBy: "sam",
    })
  })

  it("runs once: a repo unlinked afterwards stays unlinked", async () => {
    const canvas = canvasWith(
      baseRepo("r1", { repoFullName: "acme/web", name: "" })
    )
    const { library } = setup({
      repositories: [repository("web")],
      canvases: { room: canvas },
    })
    await library.list()
    canvas.ops.patch("repos", "r1", { repositoryId: undefined })

    await library.list()

    expect(repoOf(canvas, "r1")?.repositoryId).toBeUndefined()
  })

  it("retries next time when a canvas couldn't be opened, after linking the rest", async () => {
    const good = canvasWith(
      baseRepo("r1", { repoFullName: "acme/web", name: "" })
    )
    const store = memoryStore([repository("web")])
    let broken = true
    const library = createRepositoryLibrary({
      userId: "zack",
      store,
      env: memoryEnv().env,
      policy: desktopLinkPolicy,
      mint: () => ({ id: "new", now: 1 }),
      rooms: {
        list: async () => ["broken", "good"],
        read: async () => {
          throw new Error("unused")
        },
        mutate: async (roomId, fn) => {
          if (roomId === "broken" && broken) throw new Error("offline")
          return fn((roomId === "good" ? good : makeHarness()).collections)
        },
      },
    })
    const quiet = console.error
    console.error = () => {}
    try {
      await library.list()
    } finally {
      console.error = quiet
    }

    expect(repoOf(good, "r1")?.repositoryId).toBe("web")
    expect(await store.isMigrated()).toBe(false)

    broken = false
    await library.list()
    expect(await store.isMigrated()).toBe(true)
  })
})

describe("customizing a repository on a canvas", () => {
  const on = (
    canvas: ReturnType<typeof makeHarness>,
    from: RepoConfig,
    id: string
  ) =>
    // Switched on as the library lists it: stamped with its values' digest.
    switchOn(
      canvas.collections,
      { ...from, envVarsDigest: digest(from.envVars) },
      { id, createdAt: 5, addedBy: "zack" }
    )

  it("an edit on the canvas changes only that canvas, and marks it customized", () => {
    const web = repository("web")
    const a = makeHarness()
    const b = makeHarness()
    on(a, web, "repo-a")
    on(b, web, "repo-b")

    a.ops.patch("repos", "repo-a", { devScript: "pnpm dev --turbo" })

    expect(isCustomized(repoOf(a, "repo-a")!, web)).toBe(true)
    expect(repoOf(b, "repo-b")?.devScript).toBe("pnpm dev")
    expect(isCustomized(repoOf(b, "repo-b")!, web)).toBe(false)
  })

  it("ignores whitespace around agent instructions (#1479)", () => {
    const web = { ...repository("web"), systemPrompt: "Use pnpm.\n" }
    const canvas = makeHarness()
    on(canvas, web, "repo-1")
    canvas.ops.patch("repos", "repo-1", { systemPrompt: "Use pnpm." })
    expect(isCustomized(repoOf(canvas, "repo-1")!, web)).toBe(false)
  })

  it("counts a renamed label", () => {
    const web = repository("web")
    const canvas = makeHarness()
    on(canvas, web, "repo-1")
    canvas.ops.patch("repos", "repo-1", { name: "frontend" })
    expect(isCustomized(repoOf(canvas, "repo-1")!, web)).toBe(true)
  })

  it("counts env var values someone typed on the canvas, by digest (#1416)", () => {
    const web = repository("web", {
      envVars: "API_KEY=theirs",
      envVarsDigest: digest("API_KEY=theirs"),
    })
    const canvas = makeHarness()
    on(canvas, web, "repo-1")
    expect(repoOf(canvas, "repo-1")).toMatchObject({
      envVarNames: ["API_KEY"],
      envVarsDigest: digest("API_KEY=theirs"),
    })
    expect(isCustomized(repoOf(canvas, "repo-1")!, web)).toBe(false)

    canvas.ops.patch("repos", "repo-1", {
      envVarsDigest: digest("API_KEY=mine"),
    })
    expect(isCustomized(repoOf(canvas, "repo-1")!, web)).toBe(true)
  })

  it("never copies env var values into the canvas", () => {
    const web = repository("web", { envVars: "API_KEY=secret-value" })
    const canvas = makeHarness()
    on(canvas, web, "repo-1")
    expect(JSON.stringify(repoOf(canvas, "repo-1"))).not.toContain(
      "secret-value"
    )
  })

  it("treats unset fields as their defaults", () => {
    const web = repository("web")
    const canvas = makeHarness()
    on(canvas, web, "repo-1")
    canvas.ops.patch("repos", "repo-1", {
      copyPatterns: "",
      systemPrompt: "",
      defaultIframeLayerSizeId: "desktop-default",
    })
    expect(isCustomized(repoOf(canvas, "repo-1")!, web)).toBe(false)
  })

  it("Reset to Settings restores the repository's settings", () => {
    const web = repository("web", {
      envVars: "A=1",
      envVarsDigest: digest("A=1"),
    })
    const canvas = makeHarness()
    on(canvas, web, "repo-1")
    canvas.ops.patch("repos", "repo-1", {
      name: "mine",
      devServerPort: 4000,
      systemPrompt: "Be brief",
      envVarNames: ["A", "B"],
      envVarsDigest: digest("A=2\nB=3"),
    })

    resetToRepository(canvas.collections, "repo-1", web)

    expect(repoOf(canvas, "repo-1")).toMatchObject({
      name: "",
      devServerPort: 3000,
      envVarNames: ["A"],
      envVarsDigest: digest("A=1"),
    })
    expect(repoOf(canvas, "repo-1")?.systemPrompt).toBeUndefined()
    expect(isCustomized(repoOf(canvas, "repo-1")!, web)).toBe(false)
  })
})

describe("editing a repository in Settings", () => {
  it("reaches every linked canvas that hasn't customized it", async () => {
    const web = repository("web", {
      envVars: "A=1",
      envVarsDigest: digest("A=1"),
    })
    const plain = makeHarness()
    const custom = makeHarness()
    const unlinked = canvasWith(
      baseRepo("r-x", { repoFullName: "acme/web", name: "" })
    )
    switchOn(plain.collections, web, { id: "p", createdAt: 5, addedBy: "zack" })
    switchOn(custom.collections, web, {
      id: "c",
      createdAt: 5,
      addedBy: "zack",
    })
    custom.ops.patch("repos", "c", { devServerPort: 4000 })
    const { library, store, envSets } = setup({
      repositories: [web],
      canvases: { plain, custom, unlinked },
    })
    await store.markMigrated()

    await library.save({ ...web, devScript: "pnpm start", envVars: "A=9" })

    expect(repoOf(plain, "p")).toMatchObject({
      devScript: "pnpm start",
      envVarNames: ["A"],
      envVarsDigest: digest("A=9"),
    })
    // The values go to the canvas's encrypted store, only where it followed.
    expect(envSets).toEqual([["plain", "p", "A=9"]])
    expect(isCustomized(repoOf(plain, "p")!, (await library.list())[0]!)).toBe(
      false
    )
    expect(repoOf(custom, "c")).toMatchObject({
      devScript: "pnpm dev",
      devServerPort: 4000,
      envVarsDigest: digest("A=1"),
    })
    expect(repoOf(unlinked, "r-x")?.devScript).toBe("")
  })

  it("keeps a canvas's own env var values, as a customization", async () => {
    const web = repository("web", {
      envVars: "A=1",
      envVarsDigest: digest("A=1"),
    })
    const canvas = makeHarness()
    switchOn(canvas.collections, web, {
      id: "r",
      createdAt: 5,
      addedBy: "zack",
    })
    canvas.ops.patch("repos", "r", { envVarsDigest: digest("A=mine") })
    const { library, store, envSets } = setup({
      repositories: [web],
      canvases: { canvas },
    })
    await store.markMigrated()

    await library.save({ ...web, setupScript: "pnpm i", envVars: "A=9" })

    expect(repoOf(canvas, "r")).toMatchObject({
      setupScript: "pnpm install",
      envVarsDigest: digest("A=mine"),
    })
    expect(envSets).toEqual([])
  })

  it("lists repositories stamped with their values' digest, and stores them without", async () => {
    const { library, store } = setup()
    await library.save(
      repository("web", { envVars: "A=1", envVarsDigest: "stale" })
    )
    expect((await library.list())[0]?.envVarsDigest).toBe(digest("A=1"))
    expect((await store.load())[0]).not.toHaveProperty("envVarsDigest")
  })

  it("creating a repository touches no canvas", async () => {
    const canvas = canvasWith(
      baseRepo("r1", { repoFullName: "acme/web", name: "" })
    )
    const { library, store } = setup({ canvases: { canvas } })
    await store.markMigrated()
    await library.save(repository("web", { devScript: "pnpm start" }))
    expect(repoOf(canvas, "r1")?.repositoryId).toBeUndefined()
    expect(repoOf(canvas, "r1")?.devScript).not.toBe("pnpm start")
  })
})

describe("saving to all from a canvas", () => {
  const on = (
    canvas: ReturnType<typeof makeHarness>,
    from: RepoConfig,
    id: string
  ) =>
    // Switched on as the library lists it: stamped with its values' digest.
    switchOn(
      canvas.collections,
      { ...from, envVarsDigest: digest(from.envVars) },
      { id, createdAt: 5, addedBy: "zack" }
    )

  it("updates the repository and every linked canvas, clearing customizations", async () => {
    const web = repository("web", { envVars: "A=1" })
    const editing = makeHarness()
    const plain = makeHarness()
    const custom = makeHarness()
    const unlinked = canvasWith(
      baseRepo("r-x", { repoFullName: "acme/web", name: "" })
    )
    on(editing, web, "e")
    on(plain, web, "p")
    on(custom, web, "c")
    editing.ops.patch("repos", "e", { devScript: "pnpm dev --turbo" })
    custom.ops.patch("repos", "c", { name: "frontend", devServerPort: 4000 })
    const { library, store } = setup({
      repositories: [web],
      canvases: { editing, plain, custom, unlinked },
    })
    await store.markMigrated()

    const list = await library.saveToAll({
      ...web,
      devScript: "pnpm dev --turbo",
      updatedAt: 9,
    })

    expect(list).toEqual([
      {
        ...web,
        devScript: "pnpm dev --turbo",
        updatedAt: 9,
        envVarsDigest: digest("A=1"),
      },
    ])
    for (const [canvas, id] of [
      [editing, "e"],
      [plain, "p"],
      [custom, "c"],
    ] as const) {
      expect(repoOf(canvas, id)).toMatchObject({
        name: "",
        devScript: "pnpm dev --turbo",
        devServerPort: 3000,
      })
      expect(isCustomized(repoOf(canvas, id)!, list[0]!)).toBe(false)
    }
    expect(repoOf(unlinked, "r-x")?.devScript).toBe("")
  })

  it("keeps a canvas's own env var values", async () => {
    const web = repository("web", { envVars: "A=1" })
    const mine = makeHarness()
    const other = makeHarness()
    on(mine, web, "m")
    on(other, web, "o")
    mine.ops.patch("repos", "m", { envVarsDigest: digest("A=mine") })
    const { library, store, envSets } = setup({
      repositories: [web],
      canvases: { mine, other },
    })
    await store.markMigrated()

    await library.saveToAll({ ...web, envVars: "A=9" })

    expect(repoOf(mine, "m")?.envVarsDigest).toBe(digest("A=mine"))
    expect(repoOf(other, "o")?.envVarsDigest).toBe(digest("A=9"))
    expect(envSets).toEqual([["other", "o", "A=9"]])
  })

  it("leaves another person's linked repos alone", async () => {
    const web = repository("web")
    const canvas = makeHarness()
    on(canvas, repository("theirs"), "t")
    const { library, store } = setup({
      repositories: [web],
      canvases: { canvas },
    })
    await store.markMigrated()

    await library.saveToAll({ ...web, devScript: "pnpm start" })

    expect(repoOf(canvas, "t")?.devScript).toBe("pnpm dev")
  })

  it("refuses a repository that isn't yours", async () => {
    const { library, store } = setup({ repositories: [repository("web")] })
    await store.markMigrated()
    await expect(library.saveToAll(repository("other"))).rejects.toThrow()
  })
})

describe("on hosted, a canvas's copy belongs to the canvas", () => {
  /** Zack switched his "web" on a canvas he shares with Ada, and on his own. */
  function shared() {
    const web = repository("web")
    const team = makeHarness()
    const solo = makeHarness()
    switchOn(team.collections, web, { id: "t", createdAt: 5, addedBy: "zack" })
    switchOn(solo.collections, web, { id: "s", createdAt: 5, addedBy: "zack" })
    const zack = setup({
      repositories: [web],
      canvases: { team, solo },
      policy: hostedLinkPolicy,
    })
    const ada = setup({
      canvases: { team },
      policy: hostedLinkPolicy,
      userId: "ada",
    })
    return { web, team, solo, zack, ada }
  }

  it("a Settings edit reaches no canvas, shared or solo", async () => {
    const { web, team, solo, zack } = shared()
    await zack.store.markMigrated()

    await zack.library.save({ ...web, devScript: "pnpm start" })

    expect(await zack.library.list()).toEqual([
      { ...web, devScript: "pnpm start" },
    ])
    expect(repoOf(team, "t")?.devScript).toBe("pnpm dev")
    expect(repoOf(solo, "s")?.devScript).toBe("pnpm dev")
  })

  it("a teammate's edit stays on the shared canvas", async () => {
    const { web, team, solo, zack, ada } = shared()
    await zack.store.markMigrated()
    await ada.store.markMigrated()

    // Ada's Save in the edit form: the canvas's own write, nothing else.
    team.ops.patch("repos", "t", { devScript: "pnpm dev --turbo" })

    expect(await zack.library.list()).toEqual([web])
    expect(await ada.library.list()).toEqual([])
    expect(repoOf(solo, "s")?.devScript).toBe("pnpm dev")
  })

  it("refuses save to all, even from whoever added it", async () => {
    const { web, team, solo, zack, ada } = shared()
    await zack.store.markMigrated()
    await ada.store.markMigrated()
    await ada.store.save([web])

    for (const { library } of [zack, ada]) {
      await expect(
        library.saveToAll({ ...web, devScript: "pnpm start" })
      ).rejects.toThrow()
    }
    expect(await zack.store.load()).toEqual([web])
    expect(repoOf(team, "t")?.devScript).toBe("pnpm dev")
    expect(repoOf(solo, "s")?.devScript).toBe("pnpm dev")
  })
})

describe("deleting a repository", () => {
  it("counts the canvases that use it, and none that don't", async () => {
    const web = repository("web")
    const a = makeHarness()
    const b = makeHarness()
    const other = canvasWith(baseRepo("r-x", { repoFullName: "acme/web" }))
    switchOn(a.collections, web, { id: "a", createdAt: 5, addedBy: "zack" })
    switchOn(b.collections, web, { id: "b", createdAt: 5, addedBy: "zack" })
    const { library, store } = setup({
      repositories: [web, repository("api", { name: "api" })],
      canvases: { a, b, other },
    })
    await store.markMigrated()
    expect(await library.canvasCount("web")).toBe(2)
    expect(await library.canvasCount("api")).toBe(0)
  })

  it("keeps each linked canvas repo, unlinked and editable", async () => {
    const web = repository("web")
    const plain = makeHarness()
    const custom = makeHarness()
    switchOn(plain.collections, web, { id: "p", createdAt: 5, addedBy: "zack" })
    switchOn(custom.collections, web, {
      id: "c",
      createdAt: 5,
      addedBy: "zack",
    })
    plain.collections.branches.set("b1", baseBranch("b1", { repoId: "p" }))
    custom.ops.patch("repos", "c", { devServerPort: 4000 })
    const { library, store } = setup({
      repositories: [web],
      canvases: { plain, custom },
    })
    await store.markMigrated()

    expect(await library.delete("web")).toEqual([])

    expect(repoOf(plain, "p")).toMatchObject({
      repoFullName: "acme/web",
      devScript: "pnpm dev",
      addedBy: "zack",
    })
    expect(repoOf(plain, "p")?.repositoryId).toBeUndefined()
    expect(plain.collections.branches.get("b1")).toBeDefined()
    expect(repoOf(custom, "c")).toMatchObject({ devServerPort: 4000 })
    expect(repoOf(custom, "c")?.repositoryId).toBeUndefined()
    // Unlinked: the switch list shows it on, with no Repository behind it.
    expect(canvasRepositoryRows([], [repoOf(plain, "p")!])).toEqual([
      { on: true, repo: repoOf(plain, "p") },
    ])
    // Editable on its Canvas, and Settings no longer reaches it.
    plain.ops.patch("repos", "p", { devScript: "pnpm start" })
    await library.save(web)
    expect(repoOf(plain, "p")?.devScript).toBe("pnpm start")
  })

  it("with no canvas using it, just deletes it", async () => {
    const canvas = canvasWith(baseRepo("r1", { repoFullName: "acme/api" }))
    const { library, store } = setup({
      repositories: [repository("web")],
      canvases: { canvas },
    })
    await store.markMigrated()
    expect(await library.canvasCount("web")).toBe(0)
    expect(await library.delete("web")).toEqual([])
    expect(repoOf(canvas, "r1")).toEqual(
      baseRepo("r1", { repoFullName: "acme/api" })
    )
  })
})

describe("deleting a repository on hosted", () => {
  /** Rooms that fail the test if anything opens them. */
  const unreachable: CanvasRooms = {
    list: async () => {
      throw new Error("listed the canvases")
    },
    read: async () => {
      throw new Error("read a canvas")
    },
    mutate: async () => {
      throw new Error("wrote a canvas")
    },
  }

  it("neither counts nor opens another canvas", async () => {
    const web = repository("web")
    const { library, store } = setup({
      repositories: [web, repository("api", { name: "api" })],
      policy: hostedLinkPolicy,
      rooms: unreachable,
    })
    await store.markMigrated()

    expect(await library.canvasCount("web")).toBe(0)
    expect(await library.delete("web")).toEqual([
      repository("api", { name: "api" }),
    ])
  })

  it("leaves a canvas's copy as it was", async () => {
    const web = repository("web")
    const canvas = makeHarness()
    switchOn(canvas.collections, web, {
      id: "t",
      createdAt: 5,
      addedBy: "zack",
    })
    const before = repoOf(canvas, "t")
    const { library, store } = setup({
      repositories: [web],
      canvases: { canvas },
      policy: hostedLinkPolicy,
    })
    await store.markMigrated()

    await library.delete("web")

    expect(repoOf(canvas, "t")).toEqual(before)
    // With nothing to link to, the list reads it as the canvas's own.
    expect(canvasRepositoryRows([], [repoOf(canvas, "t")!])).toEqual([
      { on: true, repo: repoOf(canvas, "t") },
    ])
  })
})
