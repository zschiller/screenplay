import { spawnSync } from "node:child_process"
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import type { ModelProvider } from "@/lib/agent/providers"
import { harnessAcpAdapter, selectHarnesses } from "@/lib/agent/harnesses"
import { createHarnessSetup } from "@/lib/agent/harnesses/setup"
import {
  ANTIGRAVITY_ACP_BINARY,
  ANTIGRAVITY_ACP_VERSION,
  antigravityHarness,
  buildAntigravityInstallCommand,
  probeAntigravityAuth,
} from "./antigravity"
import type { HarnessProcessRunner } from "./types"

/**
 * Antigravity's install and sign-in are shell and Node run on the host, so
 * they run here for real, against a fake host: stand-ins for `uname`, `curl`
 * and `unzip`, and a fake ACP server that answers like Google's.
 */

const dirs: string[] = []
afterEach(() => {
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true })
})

/** Run `cmd` to completion with exactly `env`. */
function run(cmd: string, args: string[], env: Record<string, string>) {
  return spawnSync(cmd, args, {
    // Next.js types `ProcessEnv` as requiring `NODE_ENV`; a plain map is a
    // valid child env.
    env: env as NodeJS.ProcessEnv,
    encoding: "utf8",
    timeout: 20_000,
  })
}

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "antigravity-"))
  dirs.push(dir)
  return dir
}

function executable(path: string, body: string): void {
  writeFileSync(path, body)
  chmodSync(path, 0o755)
}

/** A `bin` folder whose `uname`, `curl` and `unzip` act out an install. */
function fakeInstallHost(os: string, arch: string) {
  const home = tempDir()
  const bin = tempDir()
  const log = join(bin, "curl.log")
  executable(
    join(bin, "uname"),
    `#!/bin/sh\n[ "$1" = -s ] && echo ${os} || echo ${arch}\n`
  )
  // `curl -fL --progress-bar -o <file> <url>`: note the URL, write the file.
  executable(join(bin, "curl"), `#!/bin/sh\necho "$5" > "${log}"\n: > "$4"\n`)
  // `unzip -oq <zip> -d <dir>`: unpack a stand-in server.
  executable(
    join(bin, "unzip"),
    `#!/bin/sh\nprintf '#!/bin/sh\\necho ran "$@"\\n' > "$4/${ANTIGRAVITY_ACP_BINARY}"\n`
  )
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home }
  return { home, env, url: () => readFileSync(log, "utf8").trim() }
}

describe("buildAntigravityInstallCommand", () => {
  it("installs the macOS server and a wrapper that runs it where it sits", () => {
    const host = fakeInstallHost("Darwin", "arm64")
    const result = run("sh", ["-c", buildAntigravityInstallCommand()], host.env)
    expect(result.stderr).toBe("")
    expect(result.status).toBe(0)
    expect(host.url()).toBe(
      `https://dl.google.com/agy-extensions/releases/macos/agy-acp-server-${ANTIGRAVITY_ACP_VERSION}-darwin-arm64.zip`
    )

    const wrapper = join(host.home, ".local/bin", ANTIGRAVITY_ACP_BINARY)
    const ran = spawnSync(wrapper, ["--version"], { encoding: "utf8" })
    expect(ran.stdout.trim()).toBe("ran --version")
  })

  it("passes the Linux server the empty --uid= it needs", () => {
    const host = fakeInstallHost("Linux", "x86_64")
    const result = run("sh", ["-c", buildAntigravityInstallCommand()], host.env)
    expect(result.status).toBe(0)
    expect(host.url()).toMatch(
      /\/linux\/agy-acp-server-[\d.]+-linux-x86_64\.zip$/
    )

    const wrapper = join(host.home, ".local/bin", ANTIGRAVITY_ACP_BINARY)
    const ran = spawnSync(wrapper, [], { encoding: "utf8" })
    expect(ran.stdout.trim()).toBe("ran --uid=")
  })

  it("stops on a platform with no server", () => {
    const host = fakeInstallHost("FreeBSD", "amd64")
    const result = run("sh", ["-c", buildAntigravityInstallCommand()], host.env)
    expect(result.status).not.toBe(0)
    expect(result.stderr).toContain("no ACP server for FreeBSD")
  })
})

/**
 * A fake `agy_acp_server.par`: answers `initialize` with `authMethods` and
 * `authenticate` with `authResult`, recording the method it was asked for.
 */
function fakeServer(opts: { authMethods: unknown[]; authError?: string }) {
  const bin = tempDir()
  const record = join(bin, "authenticated")
  const reply = opts.authError
    ? `{ error: { code: -32000, message: ${JSON.stringify(opts.authError)} } }`
    : "{ result: {} }"
  executable(
    join(bin, ANTIGRAVITY_ACP_BINARY),
    `#!/usr/bin/env node
const fs = require("node:fs")
let buffer = ""
const send = (m) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...m }) + "\\n")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let end
  while ((end = buffer.indexOf("\\n")) >= 0) {
    const m = JSON.parse(buffer.slice(0, end))
    buffer = buffer.slice(end + 1)
    if (m.method === "initialize") {
      // An agent request first, which the sign-in must turn down.
      send({ id: "ask", method: "fs/read_text_file", params: {} })
      send({ id: m.id, result: { protocolVersion: 1, authMethods: ${JSON.stringify(opts.authMethods)} } })
    } else if (m.method === "authenticate") {
      fs.writeFileSync(${JSON.stringify(record)}, m.params.methodId)
      send({ id: m.id, ...${reply} })
    }
  }
})
setInterval(() => {}, 1000)
`
  )
  const env = { PATH: `${bin}:${process.env.PATH}`, HOME: tempDir() }
  return { env, authenticated: () => readFileSync(record, "utf8") }
}

/** Run the sign-in the way the setup terminal does: its argv, as is. */
function signIn(env: Record<string, string>) {
  const [cmd, ...args] = antigravityHarness.authCommand!
  return run(cmd!, args, env)
}

const GOOGLE_METHODS = [
  { id: "oauth-personal", name: "Sign in with Google" },
  { id: "gemini-api-key", name: "Gemini API key" },
]

describe("the sign-in", () => {
  it("authenticates with the Google account method and exits 0", () => {
    const server = fakeServer({
      authMethods: [{ id: "gemini-api-key" }, ...GOOGLE_METHODS],
    })
    const result = signIn(server.env)
    expect(result.status).toBe(0)
    expect(result.stdout).toContain("Signed in to Antigravity.")
    expect(server.authenticated()).toBe("oauth-personal")
  })

  it("falls back to the first method offered", () => {
    const server = fakeServer({ authMethods: [{ id: "agent-platform" }] })
    expect(signIn(server.env).status).toBe(0)
    expect(server.authenticated()).toBe("agent-platform")
  })

  it("exits non-zero with the server's reason when sign-in fails", () => {
    const server = fakeServer({
      authMethods: GOOGLE_METHODS,
      authError: "Sign-in was cancelled",
    })
    const result = signIn(server.env)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Sign-in was cancelled")
  })

  it("exits non-zero when the server isn't installed", () => {
    const node = dirname(process.execPath)
    const result = signIn({
      PATH: `${tempDir()}:${node}:/usr/bin:/bin`,
      HOME: tempDir(),
    })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain("Couldn’t start Antigravity")
  })

  it("survives being chained after the install in one sh -c", async () => {
    const server = fakeServer({ authMethods: GOOGLE_METHODS })
    const setupRun = await createHarnessSetup({
      harnesses: [antigravityHarness],
      probe: async () => false,
      run: async () => ({ exitCode: 1, stdout: "" }),
      availability: { list: async () => [], invalidate() {} },
      facts: async () => ({
        npmPresent: false,
        brewPresent: false,
        arch: "arm64",
      }),
    }).commandsFor("antigravity", "install")
    const [sh, flag, script] = setupRun!.command
    // Swap the install for a no-op to run just the chained sign-in.
    const chained = script!.replace(buildAntigravityInstallCommand(), "true")
    const result = run(sh!, [flag!, chained], server.env)
    expect(result.status).toBe(0)
    expect(server.authenticated()).toBe("oauth-personal")
  })
})

describe("probeAntigravityAuth", () => {
  const reads =
    (stdout: string, exitCode = 0): HarnessProcessRunner =>
    async () => ({ exitCode, stdout })

  it("is signed in when the server's settings name an auth method", async () => {
    expect(
      await probeAntigravityAuth(reads('{"auth":{"type":"oauth-personal"}}'))
    ).toBe(true)
  })

  it("reads the settings under GEMINI_HOME, defaulting to ~/.gemini", async () => {
    let script = ""
    await probeAntigravityAuth(async (_cmd, args) => {
      script = args[1]!
      return { exitCode: 1, stdout: "" }
    })
    expect(script).toContain(
      '"${GEMINI_HOME:-$HOME/.gemini}/antigravity-acp/settings.json"'
    )
  })

  it("is signed out with no settings, no auth in them, or unreadable ones", async () => {
    expect(await probeAntigravityAuth(reads("", 1))).toBe(false)
    expect(await probeAntigravityAuth(reads('{"gcp":{}}'))).toBe(false)
    expect(await probeAntigravityAuth(reads("not json"))).toBe(false)
  })
})

describe("antigravityHarness", () => {
  it("backs chat through the installed ACP server", () => {
    expect(harnessAcpAdapter("antigravity")).toMatchObject({
      command: ANTIGRAVITY_ACP_BINARY,
      args: [],
      modelOption: "model",
      promptQueueing: false,
      plan: "reply",
    })
  })

  it("defaults to one of its own curated models", () => {
    const ids = antigravityHarness.models!.map((m) => m.id)
    expect(ids).toContain(antigravityHarness.defaultModelId)
  })

  it("is never installed in a sandbox, since Google can't be brokered", () => {
    const google: ModelProvider = {
      key: "google",
      label: "Google",
      isConfigured: () => true,
      listModels: async () => [],
      resolve: () => {
        throw new Error("not called")
      },
      egress: () => null,
    }
    const { installable, skipped } = selectHarnesses("antigravity", [google])
    expect(installable).toEqual([])
    expect(skipped.map((s) => s.key)).toEqual(["antigravity"])
  })
})
