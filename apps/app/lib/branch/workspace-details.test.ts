import { describe, expect, it } from "vitest"

import { workspaceDetails } from "@/lib/branch/workspace-details"

const repo = {
  name: "web",
  repoFullName: "northwind/web",
  repoOwner: "northwind",
  repoName: "web",
  defaultBranch: "main",
}

const running = {
  ref: "hero-gradient-trust-line",
  status: "running" as const,
  diffAdditions: 3,
  diffDeletions: 0,
}

describe("workspaceDetails", () => {
  it("lists repository, branch, base and changes", () => {
    expect(workspaceDetails(running, repo)).toEqual({
      repository: "northwind/web",
      branch: "hero-gradient-trust-line",
      base: "main",
      changes: { additions: 3, deletions: 0 },
    })
  })

  it("names a remote-less local repo by its folder", () => {
    expect(
      workspaceDetails(running, {
        ...repo,
        repoFullName: "",
        repoOwner: "",
        repoName: "",
        localPath: "/Users/me/code/web",
      }).repository
    ).toBe("/Users/me/code/web")
  })

  it("leaves out changes that aren't current", () => {
    expect(
      workspaceDetails({ ...running, status: "stopped" }, repo).changes
    ).toBeUndefined()
    expect(
      workspaceDetails(
        { ...running, diffAdditions: undefined, diffDeletions: undefined },
        repo
      ).changes
    ).toBeUndefined()
  })

  it("has no base or changes on the default branch itself", () => {
    expect(workspaceDetails({ ...running, ref: "main" }, repo)).toEqual({
      repository: "northwind/web",
      branch: "main",
    })
  })

  it("leaves out the branch while it's being created", () => {
    expect(
      workspaceDetails({ ref: "", status: "creating" }, repo).branch
    ).toBeUndefined()
  })
})
