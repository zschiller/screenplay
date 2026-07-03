import { describe, expect, it } from "vitest"

import {
  buildGhAuthLoginArgv,
  GH_AUTH_SCOPE,
} from "@/lib/host-tool/gh-auth-command"

describe("buildGhAuthLoginArgv", () => {
  it("builds the exact web-flow argv", () => {
    expect(buildGhAuthLoginArgv()).toEqual([
      "gh",
      "auth",
      "login",
      "--web",
      "--git-protocol",
      "https",
      "--scopes",
      "repo",
    ])
  })

  it("requests the `repo` scope, matching the device flow", () => {
    expect(GH_AUTH_SCOPE).toBe("repo")
    const argv = buildGhAuthLoginArgv()
    expect(argv[argv.indexOf("--scopes") + 1]).toBe("repo")
  })
})
