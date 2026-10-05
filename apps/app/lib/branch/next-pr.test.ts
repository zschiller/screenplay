import { execFile } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import * as Y from "yjs"

import {
  claimMergedPrMove,
  mergedPrNote,
  moveToDefaultTip,
  type GitRun,
} from "@/lib/branch/next-pr"
import type { RoomDoc } from "@/lib/room-access"
import { getRoomCollections } from "@/lib/yjs/schema"
import type { BranchData, RepoData } from "@/lib/types"

const run = promisify(execFile)

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "Test",
  GIT_AUTHOR_EMAIL: "test@example.com",
  GIT_COMMITTER_NAME: "Test",
  GIT_COMMITTER_EMAIL: "test@example.com",
  GIT_CONFIG_NOSYSTEM: "1",
  HOME: tmpdir(),
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await run("git", args, { cwd, env: GIT_ENV })
  return stdout.trim()
}

/** The move's git runner over a real checkout. */
function runnerIn(cwd: string): GitRun {
  return async (args) => {
    try {
      const { stdout } = await run("git", args, { cwd, env: GIT_ENV })
      return { ok: true, out: stdout.trim() }
    } catch {
      return { ok: false, out: "" }
    }
  }
}

async function commit(cwd: string, file: string, text: string) {
  await writeFile(join(cwd, file), text)
  await git(cwd, "add", file)
  await git(cwd, "commit", "--quiet", "-m", `${file}: ${text}`)
}

/**
 * A real origin and a Workspace's checkout of `checkout-polish`, whose PR #7
 * GitHub squash-merged into `main`: origin holds `refs/pull/7/head` the way
 * GitHub does, and `main` has the squash plus someone else's later commit.
 */
async function mergedWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "next-pr-"))
  const origin = join(root, "origin.git")
  const work = join(root, "work")
  const other = join(root, "other")
  await run("git", ["init", "--quiet", "--bare", "-b", "main", origin])
  await run("git", ["clone", "--quiet", origin, other], { env: GIT_ENV })
  await commit(other, "README.md", "hello")
  await git(other, "push", "--quiet", "origin", "HEAD:main")

  await run("git", ["clone", "--quiet", origin, work], { env: GIT_ENV })
  await git(work, "checkout", "--quiet", "-b", "checkout-polish")
  await commit(work, "checkout.ts", "one scroll")
  await commit(work, "checkout.ts", "one scroll, tidied")
  await git(work, "push", "--quiet", "-u", "origin", "checkout-polish")
  // GitHub keeps the PR's head under refs/pull/<n>/head.
  await git(origin, "update-ref", "refs/pull/7/head", "checkout-polish")

  // The squash merge, then a later commit on main from someone else.
  await git(other, "fetch", "--quiet", "origin")
  await git(other, "merge", "--quiet", "--squash", "origin/checkout-polish")
  await git(other, "commit", "--quiet", "-m", "One-scroll checkout (#7)")
  await commit(other, "pay.ts", "card form")
  await git(other, "push", "--quiet", "origin", "HEAD:main")
  const mainTip = await git(other, "rev-parse", "HEAD")

  return { root, origin, work, other, mainTip }
}

const claim = { ref: "checkout-polish", defaultBranch: "main", prNumber: 7 }

describe("moveToDefaultTip, on a real repo (#1701)", () => {
  let repo: Awaited<ReturnType<typeof mergedWorkspace>>
  beforeEach(async () => {
    repo = await mergedWorkspace()
  })
  afterEach(async () => {
    await rm(repo.root, { recursive: true, force: true })
  })

  it("moves a clean Branch whose commits are all in the PR onto the default tip, here and on origin", async () => {
    const outcome = await moveToDefaultTip(runnerIn(repo.work), claim)
    expect(outcome).toEqual({ kind: "moved" })
    expect(await git(repo.work, "rev-parse", "HEAD")).toBe(repo.mainTip)
    expect(await git(repo.work, "branch", "--show-current")).toBe(
      "checkout-polish"
    )
    expect(
      await git(repo.origin, "rev-parse", "refs/heads/checkout-polish")
    ).toBe(repo.mainTip)
    // The next plain `git push` the agent runs goes to the same branch.
    await commit(repo.work, "pay.ts", "apple pay")
    await git(repo.work, "push", "--quiet")
    expect(
      await git(repo.origin, "rev-parse", "refs/heads/checkout-polish")
    ).toBe(await git(repo.work, "rev-parse", "HEAD"))
    // Nothing of the move is left behind.
    expect(await git(repo.work, "for-each-ref", "refs/screenplay")).toBe("")
  })

  it("moves it when origin deleted the branch after the merge", async () => {
    await git(repo.origin, "update-ref", "-d", "refs/heads/checkout-polish")
    const outcome = await moveToDefaultTip(runnerIn(repo.work), claim)
    expect(outcome).toEqual({ kind: "moved" })
    expect(
      await git(repo.origin, "rev-parse", "refs/heads/checkout-polish")
    ).toBe(repo.mainTip)
  })

  it("hands over a Branch with uncommitted changes, untouched", async () => {
    await writeFile(join(repo.work, "checkout.ts"), "half done")
    const head = await git(repo.work, "rev-parse", "HEAD")
    const outcome = await moveToDefaultTip(runnerIn(repo.work), claim)
    expect(outcome).toEqual({ kind: "handover", reason: "uncommitted" })
    expect(await git(repo.work, "rev-parse", "HEAD")).toBe(head)
    expect(await git(repo.work, "status", "--porcelain")).toContain(
      "checkout.ts"
    )
  })

  it("hands over a Branch with a commit the PR doesn't hold, untouched", async () => {
    await commit(repo.work, "pay.ts", "started after the merge")
    const head = await git(repo.work, "rev-parse", "HEAD")
    const outcome = await moveToDefaultTip(runnerIn(repo.work), claim)
    expect(outcome).toEqual({ kind: "handover", reason: "extra-commits" })
    expect(await git(repo.work, "rev-parse", "HEAD")).toBe(head)
  })

  it("hands over when origin's copy holds a commit the PR doesn't", async () => {
    await git(repo.other, "fetch", "--quiet", "origin")
    await git(repo.other, "checkout", "--quiet", "origin/checkout-polish")
    await commit(repo.other, "late.ts", "pushed after the merge")
    await git(repo.other, "push", "--quiet", "origin", "HEAD:checkout-polish")
    const remote = await git(
      repo.origin,
      "rev-parse",
      "refs/heads/checkout-polish"
    )
    const outcome = await moveToDefaultTip(runnerIn(repo.work), claim)
    expect(outcome).toEqual({ kind: "handover", reason: "extra-commits" })
    expect(
      await git(repo.origin, "rev-parse", "refs/heads/checkout-polish")
    ).toBe(remote)
  })

  it("hands over when origin has no such PR", async () => {
    const outcome = await moveToDefaultTip(runnerIn(repo.work), {
      ...claim,
      prNumber: 8,
    })
    expect(outcome).toEqual({ kind: "handover", reason: "unreachable" })
  })
})

describe("claimMergedPrMove (#1701)", () => {
  const REPO = { id: "repo_1", defaultBranch: "main" } as RepoData

  function room(branch: Partial<BranchData>) {
    const c = getRoomCollections(new Y.Doc())
    c.repos.set(REPO.id, REPO)
    c.branches.set("branch_1", {
      id: "branch_1",
      repoId: REPO.id,
      sandboxName: "sb_1",
      ref: "checkout-polish",
      ...branch,
    } as BranchData)
    const doc: Pick<RoomDoc, "mutateDoc"> = { mutateDoc: async (fn) => fn(c) }
    return { c, room: doc }
  }
  const turn = { sandboxName: "sb_1", userId: "user_1" }

  it("claims the merged PR once, recording it on the Branch", async () => {
    const r = room({ prNumber: 7, prState: "merged" })
    expect(await claimMergedPrMove(r.room, turn)).toEqual({
      branchId: "branch_1",
      sandboxName: "sb_1",
      userId: "user_1",
      ref: "checkout-polish",
      defaultBranch: "main",
      prNumber: 7,
    })
    expect(r.c.branches.get("branch_1")?.prMovedPast).toBe(7)
    expect(await claimMergedPrMove(r.room, turn)).toBe(null)
  })

  it("claims nothing while the PR is open or closed", async () => {
    for (const prState of ["open", "closed"] as const) {
      const r = room({ prNumber: 7, prState })
      expect(await claimMergedPrMove(r.room, turn)).toBe(null)
      expect(r.c.branches.get("branch_1")?.prMovedPast).toBeUndefined()
    }
  })

  it("claims the next merged PR after an earlier one", async () => {
    const r = room({ prNumber: 9, prState: "merged", prMovedPast: 7 })
    expect((await claimMergedPrMove(r.room, turn))?.prNumber).toBe(9)
  })
})

describe("mergedPrNote (#1701)", () => {
  it("tells the agent the Branch starts from the latest code", () => {
    expect(mergedPrNote({ kind: "moved" }, claim)).toContain(
      "now starts from the latest `main`"
    )
  })

  it("hands the move to the agent with the reason", () => {
    const note = mergedPrNote(
      { kind: "handover", reason: "extra-commits" },
      claim
    )
    expect(note).toContain("commits that aren’t in #7")
    expect(note).toContain("--force-with-lease")
  })
})
