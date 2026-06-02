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

vi.mock("@/lib/sandbox", () => ({ sandboxProvider: fake.provider }))

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
    egress: () => ({ host: "api.anthropic.com", headers: { "x-api-key": "real-key" } }),
  }
}

// cloneSandbox falls back to the session's GitHub token and persists repo
// env vars. Both need a request context / KV we don't have under plain Node —
// stub them so the action's create + result shaping is what's under test.
const getUserId = vi.hoisted(() => vi.fn(async () => null as string | null))
const getGitHubToken = vi.hoisted(() => vi.fn(async () => null as string | null))
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
type RecordedCall = { cmd: string; args: string[]; env?: Record<string, string> }

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
    /** Records every `runCommand` (including its `env`) for path-seam asserts. */
    calls?: RecordedCall[]
  } = {},
): SandboxInstance {
  const notUsed = (name: string) => () => {
    throw new Error(`fake sandbox: ${name} should not be called`)
  }
  const runCommand = (cmdOrOpts: unknown, maybeArgs?: string[]) => {
    const cmd = typeof cmdOrOpts === "string" ? cmdOrOpts : (cmdOrOpts as { cmd: string }).cmd
    const args =
      typeof cmdOrOpts === "string"
        ? (maybeArgs ?? [])
        : ((cmdOrOpts as { args?: string[] }).args ?? [])
    const env =
      typeof cmdOrOpts === "string"
        ? undefined
        : (cmdOrOpts as { env?: Record<string, string> }).env
    opts.calls?.push({ cmd, args, env })
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
      }),
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
      }),
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
  return cmd === "npm" && args.includes("-g") && args.includes("@anthropic-ai/claude-code")
}

describe("installHarnesses", () => {
  it("installs the claude-code package when it's selected and its broker is configured", async () => {
    getModelProviders.mockReturnValue([configuredAnthropic()])
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push(`${cmd} ${args.join(" ")}`)
        return { exitCode: 0 }
      }),
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
      }),
    )

    const result = await installHarnesses("sandbox-a", [])

    expect(result).toEqual({ success: true, value: undefined })
    // Nothing is installed when the selection resolves to no harnesses.
    expect(seen.some((c) => isClaudeInstall(c.split(" ")[0]!, c.split(" ").slice(1)))).toBe(false)
  })

  it("installs nothing (success) when the broker provider isn't configured", async () => {
    // Default registry is empty → claude-code's anthropic broker is absent, so
    // the harness is skipped rather than failing the action.
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push(`${cmd} ${args.join(" ")}`)
        return { exitCode: 0 }
      }),
    )

    const result = await installHarnesses("sandbox-a", ["claude-code"])

    expect(result).toEqual({ success: true, value: undefined })
    expect(seen.some((c) => c.includes("@anthropic-ai/claude-code"))).toBe(false)
  })

  it("reports failure truthfully when a global install exits non-zero", async () => {
    getModelProviders.mockReturnValue([configuredAnthropic()])
    fake.setInstance(
      fakeSandbox((cmd, args) =>
        isClaudeInstall(cmd, args)
          ? { exitCode: 1, stderr: "npm ERR! network timeout" }
          : { exitCode: 0 },
      ),
    )

    const result = await installHarnesses("sandbox-a", ["claude-code"])

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toContain("npm ERR! network timeout")
  })

  it("redacts a GitHub token out of an install failure", async () => {
    getModelProviders.mockReturnValue([configuredAnthropic()])
    fake.setInstance(
      fakeSandbox((cmd, args) =>
        isClaudeInstall(cmd, args)
          ? { exitCode: 1, stderr: `install failed using ${GH_TOKEN}` }
          : { exitCode: 0 },
      ),
    )

    const result = await installHarnesses("sandbox-a", ["claude-code"])

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
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
      }),
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
      }),
    )

    await installRipgrep("sandbox-a")

    expect(seen.some((c) => c.includes("ripgrep"))).toBe(true)
  })

  it("reports success even when the install fails — it's best-effort", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 1, stderr: "no package manager" })))

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
      "tok123",
    )

    expect(result).toEqual({ success: true, value: { sandboxName: "fake-sandbox" } })
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

  it("persists repo env vars when provided", async () => {
    fake.setInstance(fakeSandbox())

    await cloneSandbox("sandbox-a", "url", "main", 3000, { FOO: "bar" }, "tok")

    expect(storeEnvVars).toHaveBeenCalledWith("fake-sandbox", { FOO: "bar" })
  })

  it("returns a redacted failure result when creation throws", async () => {
    fake.setCreateError(new Error(`provider rejected token ${GH_TOKEN}`))

    const result = await cloneSandbox("sandbox-a", "url", "main", 3000, undefined, "tok")

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
      value: { sandboxName: "fake-sandbox", previewDomain: "https://fake-4000.example.com" },
    })
  })

  it("returns a failure result when the bridge install fails", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 }), { writeError: "disk full" }))

    const result = await startDevServer("sandbox-a", 3000)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toContain("disk full")
  })

  it("redacts a GitHub token out of a launch failure", async () => {
    fake.setInstance(
      fakeSandbox(() => ({ exitCode: 0 }), { writeError: `write failed using ${GH_TOKEN}` }),
    )

    const result = await startDevServer("sandbox-a", 3000)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })
})
