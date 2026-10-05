import { beforeEach, describe, expect, it, vi } from "vitest"

import { baseRepo, makeHarness } from "@/test/canvas/harness"
import type { RoomCollections } from "@/lib/yjs/schema"

/**
 * The merge card's actions over a bare Room and a fake GitHub: they reach
 * only the canvas's repositories, merge only at the head the card showed,
 * and never for a viewer.
 */
let collections: RoomCollections
const room = vi.hoisted(() => ({ role: "editor" as string }))
vi.mock("@/lib/room-access", () => ({
  openRoom: async (roomId: string) => ({
    roomId,
    userId: "user-1",
    role: room.role,
    readDoc: async <T>(fn: (c: RoomCollections) => T) => fn(collections),
  }),
}))
vi.mock("@/lib/auth-helpers", () => ({
  getGitHubTokenForUser: async () => "tok",
}))
const github = vi.hoisted(() => ({
  merge: vi.fn(async () => ({ sha: "def456" })),
}))
vi.mock("@/lib/github-issues", () => ({
  gitHubIssuesClient: () => ({
    merge: github.merge,
    checks: async () => ({
      title: "Fix sign-in",
      url: "https://github.com/acme/web/pull/7",
      draft: false,
      sha: "abc123",
      state: "open",
      mergeableState: "clean",
      runs: [{ name: "test", status: "completed", conclusion: "failure" }],
    }),
    mergeMethods: async () => ["merge", "rebase"],
  }),
}))

import { mergeOfferedPr, offeredMergeState } from "@/lib/github-merge-actions"

beforeEach(() => {
  collections = makeHarness().collections
  collections.repos.set(
    "repo-1",
    baseRepo("repo-1", { repoOwner: "acme", repoName: "web" })
  )
  room.role = "editor"
  github.merge.mockClear()
})

describe("merge card actions", () => {
  it("reads the PR’s state, rolled-up checks and allowed methods", async () => {
    expect(
      await offeredMergeState("room-1", { repo: "acme/web", number: 7 })
    ).toMatchObject({
      ok: true,
      state: "open",
      checks: "failing",
      sha: "abc123",
      methods: ["merge", "rebase"],
    })
  })

  it("merges at the card’s head, as the member who pressed", async () => {
    expect(
      await mergeOfferedPr("room-1", {
        repo: "acme/web",
        number: 7,
        method: "merge",
        sha: "abc123",
      })
    ).toEqual({ ok: true, sha: "def456" })
    expect(github.merge).toHaveBeenCalledWith(
      { id: "repo-1", owner: "acme", name: "web" },
      7,
      { method: "merge", sha: "abc123" }
    )
  })

  it("refuses a repository outside the canvas, and a viewer", async () => {
    expect(
      await mergeOfferedPr("room-1", {
        repo: "other/repo",
        number: 7,
        method: "merge",
        sha: "abc123",
      })
    ).toEqual({
      ok: false,
      error: "other/repo isn’t one of this canvas’s repositories: acme/web.",
    })
    room.role = "viewer"
    expect(
      await mergeOfferedPr("room-1", {
        repo: "acme/web",
        number: 7,
        method: "merge",
        sha: "abc123",
      })
    ).toEqual({ ok: false, error: "Viewers can’t merge on this canvas." })
    expect(github.merge).not.toHaveBeenCalled()
  })
})
