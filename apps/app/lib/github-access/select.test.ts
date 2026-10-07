import { describe, expect, it } from "vitest"

import { selectGitHubAccess } from "@/lib/github-access"

describe("selectGitHubAccess", () => {
  it("builds the built-in config names, with its options", () => {
    const access = selectGitHubAccess({
      use: "gh-cli",
      hostname: "ghe.corp.example",
    })
    expect(access.id).toBe("gh-cli")
    expect(access.apiUrl).toBe("https://ghe.corp.example/api/v3")
  })

  it("brokers git for oauth-account", () => {
    const access = selectGitHubAccess({ use: "oauth-account" })
    expect(access.apiUrl).toBe("https://api.github.com")
    expect(access.git.kind).toBe("brokered")
  })

  it("refuses an unknown id, naming the known ones", () => {
    expect(() => selectGitHubAccess({ use: "nope" })).toThrow(
      /"nope" isn’t known \(known: oauth-account, gh-cli\)/
    )
  })
})
