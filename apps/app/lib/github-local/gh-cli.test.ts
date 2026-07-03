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

describe("gh CLI status", () => {
  /** Route each `gh` subcommand to a canned reply so one test can stage the
   *  version / token / handle probes independently. */
  function router(replies: {
    version?: { exitCode: number } | "enoent"
    token?: { exitCode: number; stdout: string }
    handle?: { exitCode: number; stdout: string } | "throws"
  }): GhProcessRunner {
    return async (cmd, args) => {
      expect(cmd).toBe("gh")
      const sub = args[0]
      if (sub === "--version") {
        if (replies.version === "enoent") {
          throw Object.assign(new Error("spawn gh ENOENT"), { code: "ENOENT" })
        }
        return { exitCode: replies.version?.exitCode ?? 0, stdout: "gh 2.0.0" }
      }
      if (sub === "auth") {
        expect(args).toEqual(["auth", "token"])
        return replies.token ?? { exitCode: 1, stdout: "" }
      }
      if (sub === "api") {
        expect(args).toEqual(["api", "user", "--jq", ".login"])
        if (replies.handle === "throws") throw new Error("offline")
        return replies.handle ?? { exitCode: 0, stdout: "octocat\n" }
      }
      throw new Error(`unexpected gh args: ${args.join(" ")}`)
    }
  }

  it("reports not-installed when gh can't be spawned", async () => {
    const status = await makeGhCli(router({ version: "enoent" })).getStatus()
    expect(status).toEqual({ kind: "not-installed" })
  })

  it("reports not-installed when gh --version exits non-zero", async () => {
    const status = await makeGhCli(
      router({ version: { exitCode: 1 } })
    ).getStatus()
    expect(status).toEqual({ kind: "not-installed" })
  })

  it("reports installed-not-authenticated on a non-zero auth token", async () => {
    const status = await makeGhCli(
      router({ token: { exitCode: 1, stdout: "" } })
    ).getStatus()
    expect(status).toEqual({ kind: "installed-not-authenticated" })
  })

  it("reports installed-not-authenticated on empty stdout", async () => {
    const status = await makeGhCli(
      router({ token: { exitCode: 0, stdout: "\n" } })
    ).getStatus()
    expect(status).toEqual({ kind: "installed-not-authenticated" })
  })

  it("reports authenticated with token and handle", async () => {
    const status = await makeGhCli(
      router({
        token: { exitCode: 0, stdout: "gho_abc123\n" },
        handle: { exitCode: 0, stdout: "octocat\n" },
      })
    ).getStatus()
    expect(status).toEqual({
      kind: "authenticated",
      token: "gho_abc123",
      handle: "octocat",
    })
  })

  it("stays authenticated with a null handle when the handle probe fails", async () => {
    const status = await makeGhCli(
      router({
        token: { exitCode: 0, stdout: "gho_abc123\n" },
        handle: "throws",
      })
    ).getStatus()
    expect(status).toEqual({
      kind: "authenticated",
      token: "gho_abc123",
      handle: null,
    })
  })
})
