import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ModelProvider } from "@/lib/agent/providers"
import type {
  SandboxCommandResult,
  SandboxCreateOptions,
  SandboxFile,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"

// The provision actions resolve (or create) the live instance through the
// provider seam. A fake provider — scripted, no real VM — stands in for Vercel
// Sandbox so we exercise the real action + runner code path. `vi.hoisted` lets
// the mock factory below close over a mutable holder we rescript per test.
const fake = vi.hoisted(() => {
  let instance: SandboxInstance | null = null
  let createError: unknown = null
  const createCalls: SandboxCreateOptions[] = []
  const provider: SandboxProvider = {
    get: vi.fn(async () => {
      if (!instance) throw new Error("test did not set a fake sandbox instance")
      return instance
    }),
    create: vi.fn(async (opts: SandboxCreateOptions) => {
      createCalls.push(opts)
      if (createError) throw createError
      if (!instance) throw new Error("test did not set a fake sandbox instance")
      return instance
    }),
  }
  return {
    provider,
    createCalls,
    reset: () => {
      instance = null
      createError = null
    },
    setInstance: (i: SandboxInstance) => {
      instance = i
      createError = null
    },
    setCreateError: (e: unknown) => {
      createError = e
    },
  }
})

// `usesHostGitAuth` is the build-time backend switch (worktree → host-native git
// auth); a mutable holder lets a test flip it to the local path.
const backend = vi.hoisted(() => ({ hostGitAuth: false }))
vi.mock("@/lib/sandbox", () => ({
  sandboxProvider: fake.provider,
  get usesHostGitAuth() {
    return backend.hostGitAuth
  },
}))

// These actions fold the provider registry into the sandbox network policy and
// resolve harness brokers from it. A reconfigurable stub lets each test set the
// registry it needs (the real one drags in the kv/db chain); it defaults to an
// empty set, so the brokered-env/egress folds contribute nothing unless a test
// opts in.
const getModelProviders = vi.hoisted(() => vi.fn(() => [] as ModelProvider[]))
vi.mock("@/lib/agent/providers", () => ({ getModelProviders }))

/** A configured, header-brokerable Anthropic stub — the claude-code broker. */
function configuredAnthropic(): ModelProvider {
  return {
    key: "anthropic",
    label: "Anthropic",
    isConfigured: () => true,
    listModels: async () => [],
    resolve: () => {
      throw new Error("stub provider: resolve should not be called")
    },
    egress: () => ({
      host: "api.anthropic.com",
      headers: { "x-api-key": "real-key" },
    }),
  }
}

/** A configured, header-brokerable OpenAI stub — the codex broker. */
function configuredOpenai(): ModelProvider {
  return {
    key: "openai",
    label: "OpenAI",
    isConfigured: () => true,
    listModels: async () => [],
    resolve: () => {
      throw new Error("stub provider: resolve should not be called")
    },
    egress: () => ({
      host: "api.openai.com",
      headers: { authorization: "Bearer real-openai-key" },
    }),
  }
}

// cloneSandbox falls back to the session's GitHub token and persists repo
// env vars. Both need a request context / KV we don't have under plain Node —
// stub them so the action's create + result shaping is what's under test.
const getUserId = vi.hoisted(() => vi.fn(async () => null as string | null))
const getGitHubToken = vi.hoisted(() =>
  vi.fn(async () => null as string | null)
)
vi.mock("@/lib/auth-helpers", () => ({ getUserId, getGitHubToken }))

const storeEnvVars = vi.hoisted(() => vi.fn(async () => {}))
const getEnvVars = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock("@/lib/env-store", () => ({ storeEnvVars, getEnvVars }))

// The bridge module ships large generated scripts; stub the constants so the
// test pins the action's write + result behavior, not the bundled payload.
vi.mock("@/lib/sandbox-bridge", () => ({
  PROXY_JS: "proxy",
  BRIDGE_JS: "bridge",
  BRIDGE_VERSION: "v-test",
}))

import {
  cloneSandbox,
  getBridgeVersion,
  installBridge,
  installHarnesses,
  installDependencies,
  installRipgrep,
  startDevServer,
} from "@/lib/sandbox/provision"

type Scripted = { exitCode: number; stdout?: string; stderr?: string }

/** A `runCommand` invocation captured by the fake sandbox for path-seam asserts. */
type RecordedCall = {
  cmd: string
  args: string[]
  env?: Record<string, string>
  detached?: boolean
}

/**
 * Builds a fake {@link SandboxInstance} whose `runCommand` is scripted by
 * `respond(cmd, args)`. `writeFiles` records what it was asked to write so a
 * test can assert the bridge install. Only the surface the actions touch is
 * implemented; everything else throws so an accidental dependency is loud.
 */
function fakeSandbox(
  respond: (cmd: string, args: string[]) => Scripted = () => ({ exitCode: 0 }),
  opts: {
    written?: SandboxFile[]
    writeError?: string
    worktreePath?: string
    homeDir?: string
    /** Port seam override; identity (the hosted behavior) by default. */
    hostPort?: (port: number) => number
    /** Records every `runCommand` (including its `env`) for path-seam asserts. */
    calls?: RecordedCall[]
  } = {}
): SandboxInstance {
  const notUsed = (name: string) => () => {
    throw new Error(`fake sandbox: ${name} should not be called`)
  }
  const runCommand = (cmdOrOpts: unknown, maybeArgs?: string[]) => {
    const cmd =
      typeof cmdOrOpts === "string"
        ? cmdOrOpts
        : (cmdOrOpts as { cmd: string }).cmd
    const args =
      typeof cmdOrOpts === "string"
        ? (maybeArgs ?? [])
        : ((cmdOrOpts as { args?: string[] }).args ?? [])
    const env =
      typeof cmdOrOpts === "string"
        ? undefined
        : (cmdOrOpts as { env?: Record<string, string> }).env
    const detached =
      typeof cmdOrOpts === "string"
        ? undefined
        : (cmdOrOpts as { detached?: boolean }).detached
    opts.calls?.push({ cmd, args, env, detached })
    const scripted = respond(cmd, args)
    const result: SandboxCommandResult = {
      exitCode: scripted.exitCode,
      stdout: async () => scripted.stdout ?? "",
      stderr: async () => scripted.stderr ?? "",
      logs: notUsed("logs") as never,
      kill: async () => {},
    }
    return Promise.resolve(result)
  }
  return {
    name: "fake-sandbox",
    worktreePath: opts.worktreePath ?? "/vercel/sandbox",
    homeDir: opts.homeDir ?? "/home/vercel-sandbox",
    domain: (port: number) => `https://fake-${port}.example.com`,
    hostPort: opts.hostPort ?? ((port: number) => port),
    runCommand: runCommand as SandboxInstance["runCommand"],
    writeFiles: async (files: SandboxFile[]) => {
      if (opts.writeError) throw new Error(opts.writeError)
      if (opts.written) opts.written.push(...files)
    },
    readFileToBuffer: notUsed("readFileToBuffer") as never,
    delete: async () => {},
  }
}

const GH_TOKEN = "ghp_0123456789abcdefABCDEF0123456789abcd"

beforeEach(() => {
  vi.clearAllMocks()
  fake.reset()
  fake.createCalls.length = 0
  backend.hostGitAuth = false
  getModelProviders.mockReturnValue([])
})

describe("installBridge", () => {
  it("writes the proxy + bridge files and returns success", async () => {
    const written: SandboxFile[] = []
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 }), { written }))

    const result = await installBridge("sandbox-a")

    expect(result).toEqual({ success: true, value: undefined })
    expect(written.map((f) => f.path)).toEqual([
      "/tmp/screenplay/proxy.mjs",
      "/tmp/screenplay/bridge.js",
    ])
  })

  it("returns a failure result when resolving the sandbox throws", async () => {
    // No instance set → provider.get rejects.
    const result = await installBridge("missing")

    expect(result.success).toBe(false)
  })
})

describe("installDependencies", () => {
  it("runs the given setup script and returns success", async () => {
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push(`${cmd} ${args.join(" ")}`)
        return { exitCode: 0 }
      })
    )

    const result = await installDependencies("sandbox-a", "pnpm install")

    expect(result).toEqual({ success: true, value: undefined })
    // The setup command is tee'd to the log through an `sh -c` wrapper.
    expect(seen.some((c) => c.includes("pnpm install"))).toBe(true)
  })

  it("defaults to `npm install` when no setup script is given", async () => {
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push(`${cmd} ${args.join(" ")}`)
        return { exitCode: 0 }
      })
    )

    await installDependencies("sandbox-a")

    expect(seen.some((c) => c.includes("npm install"))).toBe(true)
  })

  it("returns a failure result when resolving the sandbox throws", async () => {
    const result = await installDependencies("missing")

    expect(result.success).toBe(false)
  })
})

/** True for the global Claude Code install command. */
function isClaudeInstall(cmd: string, args: string[]): boolean {
  return (
    cmd === "npm" &&
    args.includes("-g") &&
    args.includes("@anthropic-ai/claude-code")
  )
}

describe("installHarnesses", () => {
  it("installs the claude-code package when it's selected and its broker is configured", async () => {
    getModelProviders.mockReturnValue([configuredAnthropic()])
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push(`${cmd} ${args.join(" ")}`)
        return { exitCode: 0 }
      })
    )

    const result = await installHarnesses("sandbox-a", ["claude-code"])

    expect(result).toEqual({ success: true, value: undefined })
    expect(seen.some((c) => c.includes("@anthropic-ai/claude-code"))).toBe(true)
  })

  it("is a no-op success when no harness keys are given", async () => {
    getModelProviders.mockReturnValue([configuredAnthropic()])
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push(`${cmd} ${args.join(" ")}`)
        return { exitCode: 0 }
      })
    )

    const result = await installHarnesses("sandbox-a", [])

    expect(result).toEqual({ success: true, value: undefined })
    // Nothing is installed when the selection resolves to no harnesses.
    expect(
      seen.some((c) => isClaudeInstall(c.split(" ")[0]!, c.split(" ").slice(1)))
    ).toBe(false)
  })

  it("installs nothing (success) when the broker provider isn't configured", async () => {
    // Default registry is empty → claude-code's anthropic broker is absent, so
    // the harness is skipped rather than failing the action.
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push(`${cmd} ${args.join(" ")}`)
        return { exitCode: 0 }
      })
    )

    const result = await installHarnesses("sandbox-a", ["claude-code"])

    expect(result).toEqual({ success: true, value: undefined })
    expect(seen.some((c) => c.includes("@anthropic-ai/claude-code"))).toBe(
      false
    )
  })

  it("logs and swallows a non-zero install (best-effort), leaving the action successful", async () => {
    getModelProviders.mockReturnValue([configuredAnthropic()])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    fake.setInstance(
      fakeSandbox((cmd, args) =>
        isClaudeInstall(cmd, args)
          ? { exitCode: 1, stderr: "npm ERR! network timeout" }
          : { exitCode: 0 }
      )
    )

    // A failed CLI is best-effort: it must not fail the action (so the Sandbox
    // stays up), but it must be logged so the failure isn't silent.
    const result = await installHarnesses("sandbox-a", ["claude-code"])

    expect(result).toEqual({ success: true, value: undefined })
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n")
    expect(logged).toContain("claude-code")
    expect(logged).toContain("npm ERR! network timeout")
    warn.mockRestore()
  })

  it("redacts a GitHub token out of a logged install failure", async () => {
    getModelProviders.mockReturnValue([configuredAnthropic()])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    fake.setInstance(
      fakeSandbox((cmd, args) =>
        isClaudeInstall(cmd, args)
          ? { exitCode: 1, stderr: `install failed using ${GH_TOKEN}` }
          : { exitCode: 0 }
      )
    )

    const result = await installHarnesses("sandbox-a", ["claude-code"])

    expect(result).toEqual({ success: true, value: undefined })
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n")
    expect(logged).not.toContain(GH_TOKEN)
    expect(logged).toContain("[REDACTED]")
    warn.mockRestore()
  })

  it("logs a skipped harness (unknown key / unconfigured broker) without failing", async () => {
    // anthropic configured ⇒ claude-code installs; "ghost" is unknown and
    // "codex" has no broker (openai absent) ⇒ both skipped with a log line.
    getModelProviders.mockReturnValue([configuredAnthropic()])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push(`${cmd} ${args.join(" ")}`)
        return { exitCode: 0 }
      })
    )

    const result = await installHarnesses("sandbox-a", [
      "ghost",
      "claude-code",
      "codex",
    ])

    expect(result).toEqual({ success: true, value: undefined })
    // The good harness still installs even though others were skipped.
    expect(seen.some((c) => c.includes("@anthropic-ai/claude-code"))).toBe(true)
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n")
    expect(logged).toContain("ghost")
    expect(logged).toContain("codex")
    warn.mockRestore()
  })

  it("installs the good harness even when another harness's install fails", async () => {
    // Both brokers configured ⇒ both selected; codex's install exits non-zero.
    // The bad CLI must not stop claude-code from installing (one bad harness
    // can't dark the whole Sandbox).
    getModelProviders.mockReturnValue([
      configuredAnthropic(),
      configuredOpenai(),
    ])
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push(`${cmd} ${args.join(" ")}`)
        const isCodexInstall =
          cmd === "npm" && args.includes("-g") && args.includes("@openai/codex")
        return isCodexInstall
          ? { exitCode: 1, stderr: "boom" }
          : { exitCode: 0 }
      })
    )

    const result = await installHarnesses("sandbox-a", ["claude-code", "codex"])

    expect(result).toEqual({ success: true, value: undefined })
    expect(seen.some((c) => c.includes("@anthropic-ai/claude-code"))).toBe(true)
    const logged = warn.mock.calls.map((c) => String(c[0])).join("\n")
    expect(logged).toContain("codex")
    warn.mockRestore()
  })

  // Path-seam regression: the claude-code seed must follow the provider-supplied
  // `worktreePath` / `homeDir` rather than the hardcoded Vercel literals. Drive
  // a mock whose paths differ from the Vercel defaults and assert the emitted
  // config tracks the mock — so a second provider with a different filesystem
  // layout seeds itself correctly.
  it("seeds .claude.json + CLAUDE.md from the sandbox paths (git infra stays in configureAgentGit)", async () => {
    getModelProviders.mockReturnValue([configuredAnthropic()])
    const calls: RecordedCall[] = []
    fake.setInstance(
      fakeSandbox(() => ({ exitCode: 0 }), {
        worktreePath: "/workspace/repo",
        homeDir: "/home/agent",
        calls,
      })
    )

    const result = await installHarnesses("sandbox-a", ["claude-code"])
    expect(result).toEqual({ success: true, value: undefined })

    // The .claude.json write is the `sh -c` whose env carries CLAUDE_CONFIG.
    const configCall = calls.find((c) => c.env?.CLAUDE_CONFIG)
    expect(configCall).toBeDefined()
    const config = JSON.parse(configCall!.env!.CLAUDE_CONFIG!)
    // The pre-trusted project key tracks the mock worktree, not /vercel/sandbox.
    expect(Object.keys(config.projects)).toEqual(["/workspace/repo"])
    // …and the file lands in the mock home dir, not /root or a shell $HOME.
    expect(configCall!.args.at(-1)).toContain('"/home/agent/.claude.json"')

    // The CLAUDE.md write targets the same home dir.
    const shArgs = calls.map((c) => c.args.join(" ")).join("\n")
    expect(shArgs).toContain("/home/agent/.claude/CLAUDE.md")
    // The git credential helper is NOT seeded here — it moved to configureAgentGit.
    expect(shArgs).not.toContain("git-credential-helper.sh")
    // No Vercel default leaks through once the provider supplies its own paths.
    expect(shArgs).not.toContain("/vercel/sandbox")
    expect(shArgs).not.toContain("/root/")
  })
})

describe("installRipgrep", () => {
  it("attempts a ripgrep install", async () => {
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push(`${cmd} ${args.join(" ")}`)
        return { exitCode: 0 }
      })
    )

    await installRipgrep("sandbox-a")

    expect(seen.some((c) => c.includes("ripgrep"))).toBe(true)
  })

  it("reports success even when the install fails — it's best-effort", async () => {
    fake.setInstance(
      fakeSandbox(() => ({ exitCode: 1, stderr: "no package manager" }))
    )

    const result = await installRipgrep("sandbox-a")

    expect(result).toEqual({ success: true, value: undefined })
  })
})

describe("cloneSandbox", () => {
  it("creates the sandbox from a token-authed git source and returns its name", async () => {
    fake.setInstance(fakeSandbox())

    const result = await cloneSandbox(
      "sandbox-a",
      "https://github.com/o/r.git",
      "main",
      3000,
      undefined,
      "tok123"
    )

    expect(result).toEqual({
      success: true,
      value: { sandboxName: "fake-sandbox" },
    })
    expect(fake.createCalls).toHaveLength(1)
    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/o/r.git",
      revision: "main",
      username: "x-access-token",
      password: "tok123",
    })
    // Devserver port, its proxy port, and the BYO-terminal daemon port are forwarded.
    expect(fake.createCalls[0]!.ports).toEqual([3000, 4000, 7681])
  })

  it("clones a public repo without auth when no token is available", async () => {
    fake.setInstance(fakeSandbox())

    await cloneSandbox("sandbox-a", "https://github.com/o/r.git", "main")

    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/o/r.git",
      revision: "main",
    })
  })

  it("clones via host auth on the local backend, never baking the token into the source", async () => {
    // The local backend clones as a host process through the user's own git
    // credentials, so even a passed token must not be spliced into the clone URL.
    backend.hostGitAuth = true
    fake.setInstance(fakeSandbox())

    await cloneSandbox(
      "sandbox-a",
      "https://github.com/o/r.git",
      "main",
      3000,
      undefined,
      "tok123"
    )

    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/o/r.git",
      revision: "main",
    })
  })

  it("persists repo env vars when provided", async () => {
    fake.setInstance(fakeSandbox())

    await cloneSandbox("sandbox-a", "url", "main", 3000, { FOO: "bar" }, "tok")

    expect(storeEnvVars).toHaveBeenCalledWith("fake-sandbox", { FOO: "bar" })
  })

  it("returns a redacted failure result when creation throws", async () => {
    fake.setCreateError(new Error(`provider rejected token ${GH_TOKEN}`))

    const result = await cloneSandbox(
      "sandbox-a",
      "url",
      "main",
      3000,
      undefined,
      "tok"
    )

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })
})

describe("getBridgeVersion", () => {
  it("returns the bridge version as a plain value (no result wrapper)", async () => {
    expect(await getBridgeVersion()).toBe("v-test")
  })
})

describe("startDevServer", () => {
  it("returns the sandbox name and the proxy preview domain on success", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 })))

    const result = await startDevServer("sandbox-a", 3000)

    // The preview points at the proxy port (devserver port + 1000), not the
    // devserver port itself.
    expect(result).toEqual({
      success: true,
      value: {
        sandboxName: "fake-sandbox",
        previewDomain: "https://fake-4000.example.com",
      },
    })
  })

  // The dev launch is the one detached command that records the dev pidfile.
  // (The proxy launch records proxy.pid; everything else is foreground.)
  const findDevLaunch = (calls: RecordedCall[]) =>
    calls.find((c) => c.detached && c.args.join(" ").includes("dev.pid"))

  it("supervises the dev server with a restart-on-crash loop, like the proxy", async () => {
    const calls: RecordedCall[] = []
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 }), { calls }))

    await startDevServer("sandbox-a", 3000, "pnpm dev")

    const devLaunch = findDevLaunch(calls)
    expect(devLaunch).toBeDefined()
    const devSh = devLaunch!.args.join(" ")
    // A crashed dev server relaunches on its own: the supervisor wraps the dev
    // command in the same `while true; … sleep 1; done` loop the proxy uses, so
    // a dead dev server comes back without any reload or reconnect.
    expect(devSh).toContain("while true")
    expect(devSh).toContain("pnpm dev")
    expect(devSh).toContain("sleep 1")
    // No `exec` — exec'ing the dev command would replace the supervisor shell
    // and break the relaunch loop.
    expect(devSh).not.toContain("exec ")
  })

  it("records the supervisor PID under setsid so the stop path group-kills the whole tree", async () => {
    const calls: RecordedCall[] = []
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 }), { calls }))

    await startDevServer("sandbox-a", 3000)

    const devLaunch = findDevLaunch(calls)
    expect(devLaunch).toBeDefined()
    const devSh = devLaunch!.args.join(" ")
    // setsid makes the supervisor its own session leader, so the recorded PID
    // equals its PGID — the stop path's `kill -KILL -<pid>` then takes down the
    // supervisor loop, its current dev child, and that child's grandchildren
    // (Next workers, esbuild) in a single group kill, leaving no orphans.
    expect(devSh).toContain("setsid")
    // The PID recorded for the stop path is the backgrounded supervisor's `$!`,
    // written to the dev pidfile — i.e. the loop, not the transient dev child.
    expect(devSh).toContain("echo $! > /tmp/screenplay/fake-sandbox/dev.pid")
  })

  it("group-kills any prior dev/proxy supervisor before launching, so a relaunch doesn't stack a second server", async () => {
    const calls: RecordedCall[] = []
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 }), { calls }))

    await startDevServer("sandbox-a", 3000)

    // The cleanup runs before the dev supervisor is launched: a kill referencing
    // both pidfiles must appear, and it must come before the detached dev launch.
    const killIdx = calls.findIndex((c) => {
      const sh = c.args.join(" ")
      return (
        sh.includes("kill -KILL") &&
        sh.includes("/tmp/screenplay/fake-sandbox/dev.pid") &&
        sh.includes("/tmp/screenplay/fake-sandbox/proxy.pid")
      )
    })
    expect(killIdx).toBeGreaterThanOrEqual(0)
    const launchIdx = calls.findIndex(
      (c) => c.detached && c.args.join(" ").includes("dev.pid")
    )
    expect(killIdx).toBeLessThan(launchIdx)
    // The group form (`kill -KILL -<pid>`) takes down the whole setsid session —
    // supervisor loop, dev child, and the child's Next/esbuild workers — not just
    // the recorded PID, leaving no orphan to fight for the port or `.next` lock.
    const killSh = calls[killIdx].args.join(" ")
    expect(killSh).toContain('kill -KILL "-$p"')
  })

  // The proxy launch is the other detached command, recording the proxy pidfile.
  const findProxyLaunch = (calls: RecordedCall[]) =>
    calls.find((c) => c.detached && c.args.join(" ").includes("proxy.pid"))

  it("hands the dev command its port as SCREENPLAY_PORT/PORT — identity values on the hosted backend", async () => {
    const calls: RecordedCall[] = []
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 }), { calls }))

    await startDevServer("sandbox-a", 3000)

    // The dev-script contract: the resolved Dev Server Port rides the dev
    // command's environment. With the identity seam (hosted), resolved ==
    // logical, so one Repo config works on both backends.
    const devLaunch = findDevLaunch(calls)
    expect(devLaunch!.env).toMatchObject({
      SCREENPLAY_PORT: "3000",
      PORT: "3000",
    })
    const proxyLaunch = findProxyLaunch(calls)
    expect(proxyLaunch!.env).toMatchObject({
      SCREENPLAY_UPSTREAM_PORT: "3000",
      SCREENPLAY_LISTEN_PORT: "4000",
    })
  })

  it("threads resolved — not logical — ports through dev, proxy, and env on a port-mapped backend", async () => {
    // A port-mapping seam under the hosted env contract: every logical port
    // maps to an allocated host port. Allocation, advertisement, and binding
    // must all agree on the resolved values, or the preview URL points at a
    // port nothing listens on.
    const calls: RecordedCall[] = []
    fake.setInstance(
      fakeSandbox(() => ({ exitCode: 0 }), {
        calls,
        hostPort: (port) => port + 50000,
      })
    )

    await startDevServer("sandbox-a", 3000, "npm run dev")

    // The dev command is told to bind the resolved port…
    const devLaunch = findDevLaunch(calls)
    expect(devLaunch!.env).toMatchObject({
      SCREENPLAY_PORT: "53000",
      PORT: "53000",
    })
    // …and the proxy binds its resolved listen port and upstreams to the
    // resolved dev port — never the logical 3000/4000.
    const proxyLaunch = findProxyLaunch(calls)
    expect(proxyLaunch!.env).toMatchObject({
      SCREENPLAY_UPSTREAM_PORT: "53000",
      SCREENPLAY_LISTEN_PORT: "54000",
    })
  })

  it("runs the dev script under portless on the local backend — port via --app-port, no SCREENPLAY_PORT", async () => {
    vi.stubEnv("SANDBOX_BACKEND", "local")
    try {
      const calls: RecordedCall[] = []
      fake.setInstance(
        fakeSandbox(() => ({ exitCode: 0 }), {
          calls,
          hostPort: (port) => port + 50000,
        })
      )

      await startDevServer("sandbox-a", 3000, "npm run dev")

      const devLaunch = findDevLaunch(calls)
      const devSh = devLaunch!.args.join(" ")
      // portless owns delivering the port: the dev command runs under
      // `portless run --app-port <resolved>` and reads `$PORT` from portless —
      // not from an env var we set ($SCREENPLAY_PORT is gone on this backend).
      expect(devSh).toContain("portless")
      expect(devSh).toContain("--app-port 53000")
      // The script rides a single `sh -c` argument so its full shell
      // semantics (env prefixes, &&, pipes) survive the wrapping.
      expect(devSh).toContain("npm run dev")
      expect(devLaunch!.env ?? {}).not.toHaveProperty("SCREENPLAY_PORT")
      expect(devLaunch!.env ?? {}).not.toHaveProperty("PORT")
      // The bridge-proxy plumbing is portless-free and unchanged: it binds the
      // resolved listen port and upstreams to the same resolved dev port
      // portless was pinned to.
      const proxyLaunch = findProxyLaunch(calls)
      expect(proxyLaunch!.env).toMatchObject({
        SCREENPLAY_UPSTREAM_PORT: "53000",
        SCREENPLAY_LISTEN_PORT: "54000",
      })
    } finally {
      vi.unstubAllEnvs()
    }
  })

  it("returns a failure result when the bridge install fails", async () => {
    fake.setInstance(
      fakeSandbox(() => ({ exitCode: 0 }), { writeError: "disk full" })
    )

    const result = await startDevServer("sandbox-a", 3000)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toContain("disk full")
  })

  it("redacts a GitHub token out of a launch failure", async () => {
    fake.setInstance(
      fakeSandbox(() => ({ exitCode: 0 }), {
        writeError: `write failed using ${GH_TOKEN}`,
      })
    )

    const result = await startDevServer("sandbox-a", 3000)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })
})
