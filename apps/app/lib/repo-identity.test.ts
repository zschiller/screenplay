import { describe, expect, it } from "vitest"

import {
  hasGitHubRemote,
  repoListTitle,
  repoShortName,
  repoSource,
} from "./repo-identity"

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

const storefront = {
  name: "",
  repoOwner: "acme",
  repoName: "storefront",
  repoFullName: "acme/storefront",
}

describe("repoShortName", () => {
  it("uses the repository's label when it has one", () => {
    expect(repoShortName({ ...storefront, name: "web" })).toBe("web")
  })

  it("falls back to the repository name, ignoring a blank label", () => {
    expect(repoShortName(storefront)).toBe("storefront")
    expect(repoShortName({ ...storefront, name: "  " })).toBe("storefront")
  })

  it("names a remote-less folder after the folder", () => {
    expect(
      repoShortName({
        repoOwner: "",
        repoName: "",
        repoFullName: "",
        localPath: "/Users/me/code/notes-app/",
      })
    ).toBe("notes-app")
  })
})

describe("repoSource", () => {
  it("is the folder for a Repo added from disk, else owner/name", () => {
    expect(repoSource(storefront)).toBe("acme/storefront")
    expect(repoSource({ ...storefront, localPath: "/code/storefront" })).toBe(
      "/code/storefront"
    )
  })
})

describe("repoListTitle", () => {
  it("is owner/name, with a label only when it tells setups apart", () => {
    expect(repoListTitle(storefront)).toEqual({
      heading: "acme/storefront",
      label: null,
    })
    expect(repoListTitle({ ...storefront, name: "storefront" }).label).toBe(
      null
    )
    expect(repoListTitle({ ...storefront, name: "default" }).label).toBe(null)
    expect(repoListTitle({ ...storefront, name: " web " }).label).toBe("web")
  })

  it("names a remote-less folder after the folder", () => {
    expect(
      repoListTitle({
        repoOwner: "",
        repoName: "",
        repoFullName: "",
        localPath: "/Users/me/code/notes-app/",
      }).heading
    ).toBe("notes-app")
  })
})
