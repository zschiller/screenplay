import { describe, expect, it } from "vitest"

import type { GhCli, GhStatus } from "@/lib/github-local/gh-cli"
import {
  makeLocalGitHubConnectionReader,
  makeLocalGitHubTokenSourceReader,
} from "@/lib/github-local/token-resolver"

function fakeGh(token: string | null): Pick<GhCli, "getToken"> {
  return { getToken: async () => token }
}

describe("local GitHub connection reader", () => {
  const read = (status: GhStatus) =>
    makeLocalGitHubConnectionReader({
      gh: { getStatus: async () => status },
    })()

  it("reports tokenSource gh with the handle when gh is authenticated", async () => {
    expect(
      await read({ kind: "authenticated", token: "t", handle: "octocat" })
    ).toEqual({
      tokenSource: "gh",
      gh: "authenticated",
      ghHandle: "octocat",
    })
  })

  it("reports a dark tokenSource when gh is signed out", async () => {
    expect(await read({ kind: "installed-not-authenticated" })).toEqual({
      tokenSource: null,
      gh: "installed-not-authenticated",
      ghHandle: null,
    })
  })

  it("reports not-installed with a dark tokenSource when nothing resolves", async () => {
    expect(await read({ kind: "not-installed" })).toEqual({
      tokenSource: null,
      gh: "not-installed",
      ghHandle: null,
    })
  })
})

describe("local GitHub token source reader", () => {
  const read = (ghToken: string | null) =>
    makeLocalGitHubTokenSourceReader({ gh: fakeGh(ghToken) })()

  it("is gh when gh has a token", async () => {
    expect(await read("gh-tok")).toBe("gh")
  })

  it("is null with no token", async () => {
    expect(await read(null)).toBeNull()
  })
})
