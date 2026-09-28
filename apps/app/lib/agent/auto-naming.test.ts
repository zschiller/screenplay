import { describe, expect, it } from "vitest"
import * as Y from "yjs"
import { getRoomCollections } from "@/lib/yjs/schema"
import type { BranchData, ChatSessionData, RepoData } from "@/lib/types"
import {
  applyNames,
  renameClaimedBranch,
  type BranchRenameClaim,
  type NamingRoom,
} from "./auto-naming"

const REPO = {
  id: "repo_1",
  repoOwner: "acme",
  repoName: "shop",
  defaultBranch: "main",
} as RepoData

/** A room doc held in memory, with the same read-modify-write seam as prod. */
function makeRoom(branch: Partial<BranchData> = {}) {
  const doc = new Y.Doc()
  const c = getRoomCollections(doc)
  c.repos.set(REPO.id, REPO)
  c.branches.set("branch_1", {
    id: "branch_1",
    repoId: REPO.id,
    sandboxName: "sb_1",
    ref: "quiet-otter",
    autoNamedBranch: true,
    ...branch,
  } as BranchData)
  c.chatSessions.set("chat_1", {
    id: "chat_1",
    label: "New chat",
  } as ChatSessionData)
  const room: NamingRoom = { mutateDoc: async (fn) => fn(c) }
  return { c, room }
}

const turn = {
  chatId: "chat_1",
  sandboxName: "sb_1",
  userId: "user_1",
  label: "Fix Checkout",
  branch: "fix-checkout",
}

/** A git rename that records each call and answers `ok`. */
function git(ok = true) {
  const calls: Array<Pick<BranchRenameClaim, "sandboxName" | "from" | "to">> =
    []
  return {
    calls,
    async renameGitBranch(claim: BranchRenameClaim) {
      calls.push({
        sandboxName: claim.sandboxName,
        from: claim.from,
        to: claim.to,
      })
      return ok
    },
  }
}

describe("auto-naming on the server", () => {
  it("a first turn writes the label, the ref and the flag, then renames git once", async () => {
    const { c, room } = makeRoom()
    const sandbox = git()

    const claim = await applyNames(room, turn)
    expect(c.chatSessions.get("chat_1")?.label).toBe("Fix Checkout")
    expect(c.branches.get("branch_1")).toMatchObject({
      ref: "fix-checkout",
      autoNamedBranch: false,
    })

    await renameClaimedBranch({ room, ...sandbox }, claim!)
    expect(sandbox.calls).toEqual([
      { sandboxName: "sb_1", from: "quiet-otter", to: "fix-checkout" },
    ])
    expect(c.branches.get("branch_1")?.ref).toBe("fix-checkout")
  })

  it("renames the Branch once when two turns race on it", async () => {
    const { c, room } = makeRoom()
    const sandbox = git()

    const claims = await Promise.all([
      applyNames(room, turn),
      applyNames(room, { ...turn, branch: "fix-checkout-2" }),
    ])
    const taken = claims.filter((x): x is BranchRenameClaim => x !== null)
    expect(taken).toHaveLength(1)
    for (const claim of taken) {
      await renameClaimedBranch({ room, ...sandbox }, claim)
    }

    expect(sandbox.calls).toHaveLength(1)
    expect(c.branches.get("branch_1")?.ref).toBe(taken[0]!.to)
  })

  it("leaves a Branch opened from an existing branch alone but still labels the chat", async () => {
    const { c, room } = makeRoom({ autoNamedBranch: false })

    const claim = await applyNames(room, turn)

    expect(claim).toBeNull()
    expect(c.branches.get("branch_1")?.ref).toBe("quiet-otter")
    expect(c.chatSessions.get("chat_1")?.label).toBe("Fix Checkout")
  })

  it("labels the chat without touching the Branch when no name was generated", async () => {
    const { c, room } = makeRoom()

    const claim = await applyNames(room, { ...turn, branch: undefined })

    expect(claim).toBeNull()
    expect(c.branches.get("branch_1")).toMatchObject({
      ref: "quiet-otter",
      autoNamedBranch: true,
    })
  })

  it("titles an untitled Workspace but never replaces a title", async () => {
    const untitled = makeRoom()
    await applyNames(untitled.room, { ...turn, title: "Checkout fix" })
    expect(untitled.c.branches.get("branch_1")?.title).toBe("Checkout fix")

    const titled = makeRoom({ title: "Mine" })
    await applyNames(titled.room, { ...turn, title: "Checkout fix" })
    expect(titled.c.branches.get("branch_1")?.title).toBe("Mine")
  })

  it("puts the Branch back when git refuses the rename", async () => {
    const { c, room } = makeRoom()

    const claim = await applyNames(room, turn)
    await renameClaimedBranch({ room, ...git(false) }, claim!)

    expect(c.branches.get("branch_1")).toMatchObject({
      ref: "quiet-otter",
      autoNamedBranch: true,
    })
  })

  it("keeps a manual rename made while git was working", async () => {
    const { c, room } = makeRoom()

    const claim = await applyNames(room, turn)
    c.branches.update("branch_1", { ref: "my-name" })
    await renameClaimedBranch({ room, ...git(false) }, claim!)

    expect(c.branches.get("branch_1")?.ref).toBe("my-name")
  })
})
