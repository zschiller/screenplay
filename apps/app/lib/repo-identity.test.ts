import { describe, expect, it } from "vitest"

import { hasGitHubRemote } from "./repo-identity"

describe("hasGitHubRemote", () => {
  it("accepts a Repo whose identity came from a GitHub remote", () => {
    expect(hasGitHubRemote({ repoOwner: "acme", repoName: "widgets" })).toBe(
      true
    )
  })

  it("rejects the remote-less local folder, which falls back to path identity", () => {
    // `inspectLocalRepoPath` leaves both empty when `origin` is absent or is not
    // a GitHub URL (ADR 0013) — the GitHub API can never name such a Repo.
    expect(hasGitHubRemote({ repoOwner: "", repoName: "" })).toBe(false)
  })

  it("rejects a half-resolved identity rather than guessing the missing half", () => {
    expect(hasGitHubRemote({ repoOwner: "acme", repoName: "" })).toBe(false)
    expect(hasGitHubRemote({ repoOwner: "", repoName: "widgets" })).toBe(false)
  })

  it("rejects a missing Repo — a lookup that lost its race offers nothing", () => {
    expect(hasGitHubRemote(undefined)).toBe(false)
    expect(hasGitHubRemote(null)).toBe(false)
  })
})
