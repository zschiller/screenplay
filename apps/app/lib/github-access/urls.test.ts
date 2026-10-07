import { describe, expect, it } from "vitest"

import {
  findPullRequestUrl,
  githubUrlsForHostname,
  parseGitHubRemote,
} from "@/lib/github-access/urls"

describe("githubUrlsForHostname", () => {
  it.each([
    ["github.com", "https://api.github.com", "https://github.com"],
    ["GitHub.com", "https://api.github.com", "https://github.com"],
    [
      "ghe.corp.example",
      "https://ghe.corp.example/api/v3",
      "https://ghe.corp.example",
    ],
    [
      "octocorp.ghe.com",
      "https://api.octocorp.ghe.com",
      "https://octocorp.ghe.com",
    ],
  ])("%s", (hostname, apiUrl, webUrl) => {
    expect(githubUrlsForHostname(hostname)).toEqual({ apiUrl, webUrl })
  })
})

describe("parseGitHubRemote", () => {
  const webUrl = "https://github.com"

  it.each([
    ["https://github.com/acme/widgets", "acme", "widgets"],
    ["https://github.com/acme/widgets.git", "acme", "widgets"],
    ["https://github.com/acme/widgets/", "acme", "widgets"],
    ["http://github.com/acme/widgets.git", "acme", "widgets"],
    ["https://x-access-token@github.com/acme/widgets.git", "acme", "widgets"],
    ["git@github.com:acme/widgets.git", "acme", "widgets"],
    ["git@github.com:acme/widgets", "acme", "widgets"],
    ["ssh://git@github.com/acme/widgets.git", "acme", "widgets"],
    ["  https://github.com/acme/widgets.git  ", "acme", "widgets"],
  ])("parses %s", (remote, owner, name) => {
    expect(parseGitHubRemote(remote, webUrl)).toEqual({ owner, name })
  })

  it.each([
    ["https://gitlab.com/acme/widgets.git"],
    ["git@bitbucket.org:acme/widgets.git"],
    ["https://githubXcom/acme/widgets.git"],
    ["https://ghe.corp.example/acme/widgets.git"],
    ["/home/me/code/widgets"],
    ["not a url"],
    [""],
  ])("returns null for a remote on another host: %s", (remote) => {
    expect(parseGitHubRemote(remote, webUrl)).toBeNull()
  })

  it("parses remotes on the configured Enterprise host", () => {
    expect(
      parseGitHubRemote(
        "git@ghe.corp.example:acme/widgets.git",
        "https://ghe.corp.example"
      )
    ).toEqual({ owner: "acme", name: "widgets" })
  })
})

describe("findPullRequestUrl", () => {
  it.each([
    [
      "Created PR #7: https://github.com/a/b/pull/7",
      "https://github.com/a/b/pull/7",
    ],
    [
      "Created PR #5: https://ghe.corp.example/acme/widgets/pull/5",
      "https://ghe.corp.example/acme/widgets/pull/5",
    ],
  ])("finds the link in %s", (text, url) => {
    expect(findPullRequestUrl(text)).toBe(url)
  })

  it("finds nothing without a pull request link", () => {
    expect(findPullRequestUrl("Failed to create PR: 422")).toBeNull()
    expect(findPullRequestUrl("see https://github.com/a/b")).toBeNull()
  })
})
