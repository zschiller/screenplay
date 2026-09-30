import { describe, expect, it } from "vitest"

import { coordinatorStart, isFreshWorkspace } from "@/lib/fresh-workspace"

const repo = {
  repoFullName: "acme/storefront",
  repoOwner: "acme",
  repoName: "storefront",
}

describe("isFreshWorkspace", () => {
  it("is a new Workspace that has had no turn", () => {
    expect(isFreshWorkspace({})).toBe(true)
    expect(isFreshWorkspace({ createFlow: "new" })).toBe(true)
  })

  it.each([
    ["a turn", { lastActivityAt: 1 }],
    ["a title from its first turn", { title: "Sticky header" }],
    [
      "a seed message waiting",
      { pendingSeed: { chatId: "c", message: "m", coordinatorChatId: "r" } },
    ],
    ["a PR", { prNumber: 12 }],
    ["changed lines", { diffAdditions: 3 }],
    ["being done", { doneAt: 1 }],
    ["an existing branch", { createFlow: "from-branch" as const }],
    ["a pinned name", { autoNamedBranch: false }],
  ])("isn't fresh with %s", (_, fields) => {
    expect(isFreshWorkspace(fields)).toBe(false)
  })
})

describe("coordinatorStart", () => {
  it("asks what should change in the one repository on a fresh canvas", () => {
    expect(coordinatorStart({ repos: [repo], branches: [{}] })).toEqual({
      kind: "fresh",
      repoName: "storefront",
    })
  })

  it("names no repository when the canvas has several", () => {
    expect(
      coordinatorStart({
        repos: [
          repo,
          { repoFullName: "acme/api", repoOwner: "acme", repoName: "api" },
        ],
        branches: [{}, {}],
      })
    ).toEqual({ kind: "fresh" })
  })

  it("asks about the canvas once any Workspace has had a turn", () => {
    expect(
      coordinatorStart({ repos: [repo], branches: [{}, { lastActivityAt: 1 }] })
    ).toEqual({ kind: "busy" })
  })

  it("asks about the canvas with no Workspace or no repository", () => {
    expect(coordinatorStart({ repos: [repo], branches: [] }).kind).toBe("busy")
    expect(coordinatorStart({ repos: [], branches: [] }).kind).toBe("busy")
  })
})
