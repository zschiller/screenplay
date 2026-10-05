import * as Y from "yjs"
import { describe, expect, it, vi } from "vitest"

import type { RoomDoc } from "@/lib/room-access"
import type { ProvisionRequest } from "@/lib/sandbox/provisioning"
import type { BranchData } from "@/lib/types"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { baseBranch, baseRepo } from "@/test/canvas/harness"

type Provision = (req: ProvisionRequest) => Promise<unknown>
let provision: Provision

vi.mock("@/lib/sandbox/provisioning", () => ({
  provisionSandbox: (req: ProvisionRequest) => provision(req),
}))
vi.mock("@/lib/kv", () => ({
  kv: { acquireLock: async () => ({ release: async () => {} }) },
}))
vi.mock("@/lib/repo-env/store", () => ({
  kvCanvasRepoEnvStore: {},
  loadCanvasRepoEnv: async () => "",
}))
vi.mock("@/lib/sandbox/inspect", () => ({
  crawlRoutes: async () => ({ success: false }),
}))

const { startBranchProvisioning } =
  await import("@/lib/branch/provisioning-live")

function room(): RoomDoc & { c: RoomCollections } {
  const doc = new Y.Doc()
  const c = createRoomCollections(doc)
  return {
    c,
    roomId: "room-1",
    readDoc: async (fn) => fn(c),
    mutateDoc: async (fn) => {
      let out!: ReturnType<typeof fn>
      doc.transact(() => {
        out = fn(c)
      })
      return out
    },
  }
}

describe("startBranchProvisioning", () => {
  it("lets the agent start once the code is checked out, before setup ends", async () => {
    const r = room()
    r.c.repos.set("repo-1", baseRepo("repo-1"))
    r.c.branches.set(
      "b1",
      baseBranch("b1", { status: "creating", codeReady: true })
    )
    const atCodeReady: Array<BranchData | undefined> = []
    let chatsAtCodeReady = 0
    provision = async (req) => {
      // A Retry's leftover flag is gone before the new checkout exists.
      expect(r.c.branches.get("b1")?.codeReady).toBeUndefined()
      await req.onCodeReady?.(req.sandboxName)
      return {
        success: true,
        value: { sandboxName: req.sandboxName, previewDomain: "p.example" },
      }
    }
    const tasks: Array<() => Promise<void>> = []

    await startBranchProvisioning(
      r,
      {
        flow: "new",
        branchId: "b1",
        sandboxName: "sandbox-b1",
        branch: "agent/b1",
        repoId: "repo-1",
      },
      {
        ghToken: undefined,
        runAfter: (task) => tasks.push(task),
        onCodeReady: async (id) => {
          atCodeReady.push(r.c.branches.get(id))
          chatsAtCodeReady = r.c.doc.getMap("chatSessions").size
        },
      }
    )
    await tasks[0]!()

    // Still creating, but ready for the agent, with its chat in place.
    expect(atCodeReady).toEqual([
      expect.objectContaining({ status: "creating", codeReady: true }),
    ])
    expect(chatsAtCodeReady).toBe(1)
    // Once setup ends it simply runs.
    const done = r.c.branches.get("b1")
    expect(done).toMatchObject({
      status: "running",
      previewDomain: "p.example",
    })
    expect(done?.codeReady).toBeUndefined()
  })

  it("never calls the agent in when the checkout fails", async () => {
    const r = room()
    r.c.repos.set("repo-1", baseRepo("repo-1"))
    r.c.branches.set("b1", baseBranch("b1", { status: "creating" }))
    provision = async () => ({ success: false, error: "Clone failed" })
    const onCodeReady = vi.fn()
    const tasks: Array<() => Promise<void>> = []

    await startBranchProvisioning(
      r,
      {
        flow: "new",
        branchId: "b1",
        sandboxName: "sandbox-b1",
        branch: "agent/b1",
        repoId: "repo-1",
      },
      { ghToken: undefined, runAfter: (t) => tasks.push(t), onCodeReady }
    )
    await tasks[0]!()

    expect(onCodeReady).not.toHaveBeenCalled()
    expect(r.c.branches.get("b1")).toMatchObject({
      status: "error",
      error: "Clone failed",
    })
  })
})
