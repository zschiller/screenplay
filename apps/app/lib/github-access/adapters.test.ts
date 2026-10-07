import { describe, expect, it, vi } from "vitest"

vi.mock("@/lib/sandbox", () => ({ sandboxProvider: {} }))

import {
  createBrokeredGitHubAccess,
  createHostGitHubAccess,
} from "@/lib/github-access/adapters"
import type { SandboxInstance } from "@/lib/sandbox/types"
import type { RepoData } from "@/lib/types"

const octo = { name: "Octo Cat", email: "octo@users.noreply.github.com" }

/** Lookups for two people: `octo` is signed in, `ghost` is unknown. */
function people() {
  return {
    token: vi.fn(async (userId: string) =>
      userId === "octo" ? "gho_octo" : null
    ),
    identity: vi.fn(async (userId: string) =>
      userId === "octo" ? octo : null
    ),
  }
}

/** A sandbox that records every command it is asked to run. */
function recordingSandbox() {
  const seen: string[] = []
  const sandbox = {
    homeDir: "/home/sandbox",
    async runCommand(
      cmdOrOpts: string | { cmd: string; args?: string[] },
      maybeArgs?: string[]
    ) {
      const cmd = typeof cmdOrOpts === "string" ? cmdOrOpts : cmdOrOpts.cmd
      const args =
        typeof cmdOrOpts === "string" ? (maybeArgs ?? []) : cmdOrOpts.args
      seen.push([cmd, ...(args ?? [])].join(" "))
      return {
        exitCode: 0,
        stdout: async () => "",
        stderr: async () => "",
      }
    },
  } as unknown as SandboxInstance
  return { sandbox, seen }
}

const repo = { repoOwner: "o", repoName: "r" } as RepoData

describe("brokered GitHub access", () => {
  it("answers each person's token, transport env and identity", async () => {
    const access = createBrokeredGitHubAccess(people())

    expect(access.requiresToken).toBe(true)
    expect(await access.token("octo")).toBe("gho_octo")
    expect(await access.transportEnv("octo")).toEqual({
      SCREENPLAY_GH_TOKEN: "gho_octo",
    })
    expect(await access.identity("octo")).toEqual(octo)
    expect(await access.commitEnv("octo")).toEqual({
      SCREENPLAY_GH_TOKEN: "gho_octo",
      GIT_AUTHOR_NAME: "Octo Cat",
      GIT_AUTHOR_EMAIL: "octo@users.noreply.github.com",
      GIT_COMMITTER_NAME: "Octo Cat",
      GIT_COMMITTER_EMAIL: "octo@users.noreply.github.com",
    })
  })

  it("brokers nothing for someone with no token or identity", async () => {
    const access = createBrokeredGitHubAccess(people())

    expect(await access.token("ghost")).toBeNull()
    expect(await access.transportEnv("ghost")).toBeUndefined()
    expect(await access.identity("ghost")).toBeNull()
    expect(await access.commitEnv("ghost")).toBeUndefined()
  })

  it("splices a token into a clone, and only a token", () => {
    const access = createBrokeredGitHubAccess(people())

    expect(access.cloneCredentials("gho_octo")).toEqual({
      username: "x-access-token",
      password: "gho_octo",
    })
    expect(access.cloneCredentials(undefined)).toBeUndefined()
  })

  it("points origin at GitHub and installs the credential helper", async () => {
    const access = createBrokeredGitHubAccess(people())
    const { sandbox, seen } = recordingSandbox()

    await access.prepareCheckout(sandbox, repo, "octo")

    const joined = seen.join("\n")
    expect(joined).toContain(
      "git config user.email octo@users.noreply.github.com"
    )
    expect(joined).toContain(
      "git remote set-url origin https://github.com/o/r.git"
    )
    expect(joined).toContain(
      "/home/sandbox/.screenplay/git-credential-helper.sh"
    )
  })
})

describe("host GitHub access", () => {
  it("answers the gh token and leaves transport and identity to the host", async () => {
    const lookup = people()
    const access = createHostGitHubAccess({ token: lookup.token })

    expect(access.requiresToken).toBe(false)
    expect(await access.token("octo")).toBe("gho_octo")
    expect(await access.transportEnv("octo")).toBeUndefined()
    expect(await access.identity("octo")).toBeNull()
    expect(await access.commitEnv("octo")).toBeUndefined()
    expect(access.cloneCredentials("gho_octo")).toBeUndefined()
    // Git rides host credentials: transport never looks the token up.
    expect(lookup.token).toHaveBeenCalledTimes(1)
  })

  it("leaves the checkout's git config and remote alone", async () => {
    const access = createHostGitHubAccess(people())
    const { sandbox, seen } = recordingSandbox()

    await access.prepareCheckout(sandbox, repo, "octo")

    expect(seen).toEqual([])
  })
})
