import { describe, expect, it } from "vitest"

import { createGhCliAccess, ghCliOf } from "@/lib/github-access/gh-cli"

describe("gh-cli", () => {
  it("runs gh auth token and leaves git to the host", async () => {
    const calls: string[][] = []
    const access = createGhCliAccess(async (cmd, args) => {
      calls.push([cmd, ...args])
      return { exitCode: 0, stdout: "gho_x\n" }
    })
    expect(await access.apiToken("local")).toBe("gho_x")
    expect(calls).toEqual([["gh", "auth", "token"]])
    expect(access.git).toEqual({ kind: "host" })
  })

  it("exposes its CLI for the connection row", () => {
    const access = createGhCliAccess(async () => ({ exitCode: 0, stdout: "" }))
    expect(ghCliOf(access)).not.toBeNull()
  })
})
