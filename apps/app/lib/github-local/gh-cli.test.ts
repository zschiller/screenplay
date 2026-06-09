import { describe, expect, it } from "vitest"

import { makeGhCli, type GhProcessRunner } from "@/lib/github-local/gh-cli"

describe("gh CLI adapter", () => {
  it("yields the token when gh is present and authenticated", async () => {
    const run: GhProcessRunner = async (cmd, args) => {
      expect(cmd).toBe("gh")
      expect(args).toEqual(["auth", "token"])
      return { exitCode: 0, stdout: "gho_abc123\n" }
    }
    expect(await makeGhCli(run).getToken()).toBe("gho_abc123")
  })

  it("yields no token when gh is present but unauthenticated", async () => {
    const run: GhProcessRunner = async () => ({
      exitCode: 1,
      stdout: "",
    })
    expect(await makeGhCli(run).getToken()).toBeNull()
  })

  it("yields no token when gh is absent", async () => {
    const run: GhProcessRunner = async () => {
      throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" })
    }
    expect(await makeGhCli(run).getToken()).toBeNull()
  })

  it("treats an empty token as unauthenticated", async () => {
    const run: GhProcessRunner = async () => ({ exitCode: 0, stdout: "\n" })
    expect(await makeGhCli(run).getToken()).toBeNull()
  })
})
