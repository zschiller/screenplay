import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import type { RoomDoc } from "@/lib/room-access"
import type { RepoData } from "@/lib/types"
import { getRoomCollections } from "@/lib/yjs/schema"
import {
  canvasRepoEnv,
  memoryCanvasRepoEnvStore,
  writeCanvasRepoEnv,
  type EnvViewer,
} from "./canvas-repo-env"
import { envVarsDigest } from "./encoding"

process.env.ENCRYPTION_KEY = "11".repeat(32)

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

/** A Canvas in memory: an in-memory Y.Doc and an in-memory store, either of
 *  which can be made to fail. */
function setup(repos: RepoData[], stored: Record<string, string> = {}) {
  const doc = new Y.Doc()
  const c = getRoomCollections(doc)
  for (const r of repos) c.repos.set(r.id, r)
  const store = memoryCanvasRepoEnvStore()
  for (const [id, text] of Object.entries(stored)) {
    store.rows.set(`room-1:${id}`, text)
  }
  const faults = { store: false, doc: false }
  const room: RoomDoc = {
    roomId: "room-1",
    readDoc: async (fn) => fn(c),
    mutateDoc: async (fn) => {
      if (faults.doc) throw new Error("doc down")
      return fn(c)
    },
  }
  const set = store.set
  store.set = async (...args) => {
    if (faults.store) throw new Error("KV down")
    return set(...args)
  }
  const docJson = () => JSON.stringify(doc.toJSON())
  return { c, room, store, faults, docJson }
}

const ada: EnvViewer = { userId: "ada", role: "editor", localBuild: false }
const grace: EnvViewer = { ...ada, userId: "grace" }
const named = (text: string) => ({
  envVarNames: text.split("\n").map((l) => l.split("=")[0]),
  envVarsDigest: envVarsDigest(text),
})

describe("Canvas Repo env", () => {
  describe("save", () => {
    it("stores the adder’s text whole, then names it in the doc", async () => {
      const { c, room, store } = setup([repo("r1", { addedBy: "ada" })], {
        r1: "A=1\nB=2",
      })

      const fields = await canvasRepoEnv(room, store, ada).save("r1", "C=3")

      expect(fields).toEqual(named("C=3"))
      expect(await store.get("room-1", "r1")).toBe("C=3")
      expect(c.repos.get("r1")).toMatchObject(named("C=3"))
    })

    it("lays anyone else’s lines over the stored values", async () => {
      const { c, room, store } = setup([repo("r1", { addedBy: "ada" })], {
        r1: "A=1\nB=2",
      })

      await canvasRepoEnv(room, store, grace).save("r1", "B=mine")

      expect(await store.get("room-1", "r1")).toBe("A=1\nB=mine")
      expect(c.repos.get("r1")).toMatchObject(named("A=1\nB=mine"))
    })

    it("merges over a legacy plain-text copy the migration hasn’t moved", async () => {
      const { c, room, store, docJson } = setup([
        repo("r1", { addedBy: "ada", envVars: "A=sk_live_old" }),
      ])

      await canvasRepoEnv(room, store, grace).save("r1", "B=2")

      expect(await store.get("room-1", "r1")).toBe("A=sk_live_old\nB=2")
      expect(c.repos.get("r1")).not.toHaveProperty("envVars")
      expect(docJson()).not.toContain("sk_live_old")
    })

    it("leaves doc and store as they were when the store fails", async () => {
      const { c, room, store, faults } = setup(
        [repo("r1", { addedBy: "ada", ...named("A=1") })],
        { r1: "A=1" }
      )
      faults.store = true

      await expect(
        canvasRepoEnv(room, store, ada).save("r1", "B=2")
      ).rejects.toThrow("KV down")

      expect(await store.get("room-1", "r1")).toBe("A=1")
      expect(c.repos.get("r1")).toMatchObject(named("A=1"))
    })

    it("refuses viewers and Repos the Canvas doesn’t have, touching nothing", async () => {
      const { room, store } = setup([repo("r1")])
      await expect(
        canvasRepoEnv(room, store, { ...ada, role: "viewer" }).save("r1", "A=1")
      ).rejects.toThrow("Viewers can’t change settings")
      await expect(
        canvasRepoEnv(room, store, ada).save("gone", "A=1")
      ).rejects.toThrow("Repository not found")
      expect(store.rows.size).toBe(0)
    })
  })

  describe("reset", () => {
    it("replaces the Canvas’s values with the Repository’s, then names them", async () => {
      const { c, room, store } = setup(
        [repo("r1", { addedBy: "ada", ...named("A=mine") })],
        { r1: "A=mine" }
      )

      await canvasRepoEnv(room, store, ada).reset("r1", "A=1\nB=2")

      expect(await store.get("room-1", "r1")).toBe("A=1\nB=2")
      expect(c.repos.get("r1")).toMatchObject(named("A=1\nB=2"))
    })

    it("clears names and digest when the Repository has no values", async () => {
      const { c, room, store } = setup(
        [repo("r1", { addedBy: "ada", ...named("A=mine") })],
        { r1: "A=mine" }
      )

      await canvasRepoEnv(room, store, ada).reset("r1", "")

      expect(store.rows.size).toBe(0)
      expect(c.repos.get("r1")?.envVarNames).toBeUndefined()
      expect(c.repos.get("r1")?.envVarsDigest).toBeUndefined()
    })

    it("is refused to anyone who can’t reveal the values", async () => {
      const { c, room, store } = setup(
        [repo("r1", { addedBy: "ada", ...named("A=1") })],
        { r1: "A=1" }
      )

      await expect(
        canvasRepoEnv(room, store, grace).reset("r1", "")
      ).rejects.toThrow("Only the person who added this repository")

      expect(await store.get("room-1", "r1")).toBe("A=1")
      expect(c.repos.get("r1")).toMatchObject(named("A=1"))
    })

    it("leaves the doc unchanged when the store fails", async () => {
      const { c, room, store, faults } = setup(
        [repo("r1", { addedBy: "ada", ...named("A=mine") })],
        { r1: "A=mine" }
      )
      faults.store = true

      await expect(
        canvasRepoEnv(room, store, ada).reset("r1", "A=1")
      ).rejects.toThrow("KV down")

      expect(c.repos.get("r1")).toMatchObject(named("A=mine"))
    })
  })

  describe("copyIn", () => {
    it("stores values under a new Repo’s id and hands back its fields", async () => {
      const { c, room, store } = setup([])

      const fields = await canvasRepoEnv(room, store, ada).copyIn("r1", "A=1")

      expect(fields).toEqual(named("A=1"))
      expect(await store.get("room-1", "r1")).toBe("A=1")
      // The Repo's record is created with them, by whoever switches it on.
      expect(c.repos.get("r1")).toBeUndefined()
    })

    it("never overwrites a Repo that’s already there or already stored", async () => {
      const { room, store } = setup([repo("r1")], { r2: "A=1" })
      const env = canvasRepoEnv(room, store, ada)

      await expect(env.copyIn("r1", "B=2")).rejects.toThrow()
      await expect(env.copyIn("r2", "B=2")).rejects.toThrow()
      expect(await store.get("room-1", "r1")).toBeNull()
      expect(await store.get("room-1", "r2")).toBe("A=1")
    })

    it("rejects when the store fails", async () => {
      const { room, store, faults } = setup([])
      faults.store = true
      await expect(
        canvasRepoEnv(room, store, ada).copyIn("r1", "A=1")
      ).rejects.toThrow("KV down")
    })
  })

  describe("reveal", () => {
    it("is the adder’s; the owner’s when nobody recorded one; anyone’s on desktop", async () => {
      const { room, store } = setup(
        [repo("r1", { addedBy: "ada" }), repo("r2")],
        {
          r1: "A=1",
          r2: "B=2",
        }
      )

      expect(await canvasRepoEnv(room, store, ada).reveal("r1")).toBe("A=1")
      await expect(
        canvasRepoEnv(room, store, grace).reveal("r1")
      ).rejects.toThrow("Only the person who added this repository")
      await expect(
        canvasRepoEnv(room, store, { ...ada, role: "owner" }).reveal("r1")
      ).resolves.toBe("A=1")
      await expect(
        canvasRepoEnv(room, store, ada).reveal("r2")
      ).rejects.toThrow()
      expect(
        await canvasRepoEnv(room, store, { ...grace, role: "owner" }).reveal(
          "r2"
        )
      ).toBe("B=2")
      expect(
        await canvasRepoEnv(room, store, { ...grace, localBuild: true }).reveal(
          "r1"
        )
      ).toBe("A=1")
    })
  })

  describe("writeCanvasRepoEnv", () => {
    it("never names values in the doc before the store has them", async () => {
      const { c, room, store } = setup([repo("r1")])
      const set = store.set
      store.set = async (...args) => {
        expect(c.repos.get("r1")?.envVarNames).toBeUndefined()
        return set(...args)
      }

      await writeCanvasRepoEnv(room, store, "r1", "A=1")

      expect(c.repos.get("r1")).toMatchObject(named("A=1"))
    })

    it("keeps the values stored when the doc write fails, and reports it", async () => {
      const { c, room, store, faults } = setup([repo("r1")])
      faults.doc = true

      await expect(
        writeCanvasRepoEnv(room, store, "r1", "A=1")
      ).rejects.toThrow("doc down")
      // Stored but unnamed: Workspaces get them, the doc claims nothing new.
      expect(await store.get("room-1", "r1")).toBe("A=1")
      expect(c.repos.get("r1")?.envVarNames).toBeUndefined()
    })
  })
})
