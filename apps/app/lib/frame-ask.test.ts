import { describe, expect, it } from "vitest"

import { defaultNewWorkspaceRepoId, withViewport } from "@/lib/frame-ask"
import type { BranchData, RepoData } from "@/lib/types"

const repo = (id: string, repoFullName: string) =>
  ({ id, repoFullName }) as RepoData
const branch = (id: string, repoId: string, createdAt: number) =>
  ({ id, repoId, createdAt }) as BranchData

describe("defaultNewWorkspaceRepoId", () => {
  it("picks the newest Workspace's Repo", () => {
    const repos = [repo("a", "acme/a"), repo("b", "acme/b")]
    const branches = [branch("1", "a", 1), branch("2", "b", 5)]
    expect(defaultNewWorkspaceRepoId(repos, branches)).toBe("b")
  })

  it("falls back to the first Repo in sidebar order", () => {
    const repos = [repo("z", "acme/z"), repo("a", "acme/a")]
    expect(defaultNewWorkspaceRepoId(repos, [])).toBe("a")
  })

  it("is null with no Repos", () => {
    expect(defaultNewWorkspaceRepoId([], [])).toBeNull()
  })
})

describe("withViewport", () => {
  it("adds the frame size after the prompt", () => {
    expect(withViewport("A checkout page", { width: 390, height: 844 })).toBe(
      "A checkout page\n\nFor a 390 × 844 viewport."
    )
  })

  it("rounds the size", () => {
    expect(withViewport("x", { width: 390.4, height: 843.6 })).toBe(
      "x\n\nFor a 390 × 844 viewport."
    )
  })
})
