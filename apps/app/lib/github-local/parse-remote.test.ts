import { describe, expect, it } from "vitest"

import { parseGitHubRemote } from "@/lib/github-local/parse-remote"

describe("parseGitHubRemote", () => {
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
    expect(parseGitHubRemote(remote)).toEqual({ owner, name })
  })

  it.each([
    ["https://gitlab.com/acme/widgets.git"],
    ["git@bitbucket.org:acme/widgets.git"],
    ["/home/me/code/widgets"],
    ["not a url"],
    [""],
  ])("returns null for non-GitHub remote %s", (remote) => {
    expect(parseGitHubRemote(remote)).toBeNull()
  })
})
