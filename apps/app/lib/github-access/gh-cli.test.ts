import fs from "node:fs"

import { afterAll, afterEach, describe, expect, it, vi } from "vitest"

// A company `gh` wrapper on a GitHub Enterprise Server host, end to end: a real
// stub executable stands in for the wrapper, and fetch stands in for GHES.
const stub = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require("node:fs") as typeof import("node:fs")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require("node:os") as typeof import("node:os")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("node:path")
  const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "corp-gh-"))
  const log = nodePath.join(dir, "argv.log")
  const command = nodePath.join(dir, "corp-gh")
  // Answers only when called with the GHES hostname, like a real gh would
  // for a host it's signed in to.
  nodeFs.writeFileSync(
    command,
    [
      "#!/bin/sh",
      `echo "$*" >> "${log}"`,
      'case "$*" in',
      '  "--version") echo "corp-gh 1.0" ;;',
      '  "auth token --hostname ghe.corp.example") echo "ghes_token" ;;',
      '  "api --hostname ghe.corp.example user --jq .login") echo "octo" ;;',
      "  *) exit 1 ;;",
      "esac",
      "",
    ].join("\n"),
    { mode: 0o755 }
  )
  return { dir, log, command }
})

vi.mock("@/lib/github-access", async () => {
  const { createGhCliAccess } = await import("./gh-cli")
  return {
    githubAccess: createGhCliAccess({
      command: stub.command,
      hostname: "ghe.corp.example",
    }),
  }
})

import { githubAccess } from "@/lib/github-access"
import { createGhCliAccess, ghCliOf } from "@/lib/github-access/gh-cli"
import { findPullRequestUrl, parseGitHubRemote } from "@/lib/github-access/urls"
import { gitHubIssuesClient } from "@/lib/github-issues"
import { githubPrReader } from "@/lib/pr-watch/github"

afterEach(() => {
  vi.unstubAllGlobals()
  fs.rmSync(stub.log, { force: true })
})

afterAll(() => {
  fs.rmSync(stub.dir, { recursive: true, force: true })
})

const argv = () => fs.readFileSync(stub.log, "utf8").trim().split("\n")

describe("gh-cli with a wrapper command on GitHub Enterprise Server", () => {
  it("derives the GHES API and web URLs from the hostname", () => {
    expect(githubAccess.apiUrl).toBe("https://ghe.corp.example/api/v3")
    expect(githubAccess.webUrl).toBe("https://ghe.corp.example")
  })

  it("gets the token from the wrapper, passing --hostname", async () => {
    expect(await githubAccess.apiToken("anyone")).toBe("ghes_token")
    expect(argv()).toEqual(["auth token --hostname ghe.corp.example"])
  })

  it("leaves git to the host", () => {
    expect(githubAccess.git).toEqual({ kind: "host" })
  })

  it("reports the wrapper's sign-in and handle for the connection row", async () => {
    const status = await ghCliOf(githubAccess)!.getStatus()
    expect(status).toEqual({
      kind: "authenticated",
      token: "ghes_token",
      handle: "octo",
    })
  })

  it("sends API calls to the GHES host", async () => {
    const urls: string[] = []
    const fetchImpl = (async (url: string) => {
      urls.push(url)
      return new Response("[]", { status: 200 })
    }) as typeof fetch
    const token = await githubAccess.apiToken("anyone")
    await gitHubIssuesClient(token!, fetchImpl).labels({
      owner: "acme",
      name: "widgets",
    })
    expect(urls[0]).toMatch(
      /^https:\/\/ghe\.corp\.example\/api\/v3\/repos\/acme\/widgets\/labels/
    )
  })

  it("recognises GHES remotes and not github.com ones", () => {
    const { webUrl } = githubAccess
    for (const remote of [
      "https://ghe.corp.example/acme/widgets.git",
      "git@ghe.corp.example:acme/widgets.git",
      "ssh://git@ghe.corp.example/acme/widgets",
    ]) {
      expect(parseGitHubRemote(remote, webUrl)).toEqual({
        owner: "acme",
        name: "widgets",
      })
    }
    expect(
      parseGitHubRemote("https://github.com/acme/widgets.git", webUrl)
    ).toBeNull()
  })

  it("reads a GHES pull request and its link", async () => {
    const urls: string[] = []
    vi.stubGlobal("fetch", async (url: string) => {
      urls.push(url)
      return new Response(
        JSON.stringify([
          {
            number: 5,
            html_url: "https://ghe.corp.example/acme/widgets/pull/5",
            state: "closed",
            merged_at: "2026-10-07T00:00:00Z",
            created_at: "2026-10-06T00:00:00Z",
            head: { sha: "abc" },
          },
        ]),
        { status: 200 }
      )
    })
    const read = githubPrReader(() => githubAccess.apiToken("anyone"))
    const pr = await read({
      branchId: "b1",
      owner: "acme",
      repo: "widgets",
      branch: "feature",
    })
    expect(urls[0]).toMatch(
      /^https:\/\/ghe\.corp\.example\/api\/v3\/repos\/acme\/widgets\/pulls\?/
    )
    expect(pr?.url).toBe("https://ghe.corp.example/acme/widgets/pull/5")
    expect(findPullRequestUrl(`Created PR #5: ${pr?.url}`)).toBe(
      "https://ghe.corp.example/acme/widgets/pull/5"
    )
  })
})

describe("gh-cli options", () => {
  it("defaults to gh on github.com with no --hostname", async () => {
    const calls: string[][] = []
    const access = createGhCliAccess({}, async (cmd, args) => {
      calls.push([cmd, ...args])
      return { exitCode: 0, stdout: "gho_x\n" }
    })
    expect(access.apiUrl).toBe("https://api.github.com")
    expect(access.webUrl).toBe("https://github.com")
    expect(await access.apiToken("local")).toBe("gho_x")
    expect(calls).toEqual([["gh", "auth", "token"]])
  })

  it("takes a multi-word command", async () => {
    const calls: string[][] = []
    const access = createGhCliAccess(
      { command: ["corp", "gh"] },
      async (cmd, args) => {
        calls.push([cmd, ...args])
        return { exitCode: 0, stdout: "t\n" }
      }
    )
    await access.apiToken("local")
    expect(calls).toEqual([["corp", "gh", "auth", "token"]])
  })

  it("lets apiUrl and webUrl override the hostname", () => {
    const access = createGhCliAccess({
      hostname: "ghe.corp.example",
      apiUrl: "https://api.ghe.corp.example/",
      webUrl: "https://code.corp.example",
    })
    expect(access.apiUrl).toBe("https://api.ghe.corp.example")
    expect(access.webUrl).toBe("https://code.corp.example")
  })

  it.each([
    [{ comand: "corp-gh" }, /unknown option "comand"/],
    [{ command: 3 }, /"command" must be a command name/],
    [{ hostname: "" }, /"hostname" must be a non-empty string/],
    [{ apiUrl: "not a url" }, /"apiUrl" must be a URL/],
  ])("refuses bad options %j", (options, message) => {
    expect(() => createGhCliAccess(options)).toThrow(message)
  })
})
