import { describe, expect, it } from "vitest"

import { selectGitHubAccess } from "@/lib/github-access"

describe("selectGitHubAccess", () => {
  it("is oauth-account on Hosted, with no override", () => {
    const access = selectGitHubAccess({})
    expect(access.id).toBe("oauth-account")
    expect(access.git.kind).toBe("brokered")
  })

  it("takes GITHUB_ACCESS over the profile's default", () => {
    const access = selectGitHubAccess({ GITHUB_ACCESS: "gh-cli" })
    expect(access.id).toBe("gh-cli")
    expect(access.git.kind).toBe("host")
  })

  it("refuses an unknown id, naming the known ones", () => {
    expect(() => selectGitHubAccess({ GITHUB_ACCESS: "nope" })).toThrow(
      /"nope" isn’t known \(known: oauth-account, gh-cli\)/
    )
  })
})
