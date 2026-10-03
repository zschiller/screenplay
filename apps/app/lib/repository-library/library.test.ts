import { describe, expect, it } from "vitest"
import type { RepoConfig } from "@/lib/repo-configs.types"
import type { RoomCollections } from "@/lib/yjs/schema"
import {
  baseBranch,
  baseChat,
  baseRepo,
  makeHarness,
} from "@/test/canvas/harness"
import {
  canvasRepositoryRows,
  createRepositoryLibrary,
  isCustomized,
  linkedRepo,
  resetToRepository,
  switchOff,
  switchOn,
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

/** A fake keyed digest: equal text, equal digest. */
const digest = (text: string) => (text.trim() ? `d:${text.trim()}` : undefined)

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
  mode = "desktop",
  userId = "zack",
}: {
  repositories?: RepoConfig[]
  canvases?: Record<string, ReturnType<typeof makeHarness>>
  mode?: "desktop" | "hosted"
  userId?: string
} = {}) {
  let n = 0
  const store = memoryStore(repositories)
  const { env, sets } = memoryEnv()
  const library = createRepositoryLibrary({
    userId,
    store,
    env,
    mode,
    mint: () => ({ id: `new-${++n}`, now: 100 + n }),
    rooms: {
      list: async () => Object.keys(canvases),
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

describe("the canvas switch list", () => {
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
    const { library } = setup({ canvases: { room: canvas }, mode: "hosted" })

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
      mode: "hosted",
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
      mode: "desktop",
      mint: () => ({ id: "new", now: 1 }),
      rooms: {
        list: async () => ["broken", "good"],
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
  ) => switchOn(canvas.collections, from, { id, createdAt: 5, addedBy: "zack" })

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
