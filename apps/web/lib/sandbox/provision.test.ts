import { beforeEach, describe, expect, it, vi } from "vitest"

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

// These actions fold the provider registry into the sandbox network policy.
// Stub it to an empty set — the egress policy is covered by
// network-policy.test.ts, and the real registry drags in the kv/db chain.
vi.mock("@/lib/agent/providers", () => ({ getModelProviders: () => [] }))

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
  installClaudeCode,
  installDependencies,
  installRipgrep,
  startDevServer,
} from "@/lib/sandbox/provision"

type Scripted = { exitCode: number; stdout?: string; stderr?: string }

/**
 * Builds a fake {@link SandboxInstance} whose `runCommand` is scripted by
 * `respond(cmd, args)`. `writeFiles` records what it was asked to write so a
 * test can assert the bridge install. Only the surface the actions touch is
 * implemented; everything else throws so an accidental dependency is loud.
 */
function fakeSandbox(
  respond: (cmd: string, args: string[]) => Scripted = () => ({ exitCode: 0 }),
  opts: { status?: string; written?: SandboxFile[]; writeError?: string } = {},
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
    status: opts.status ?? "running",
    domain: (port: number) => `https://fake-${port}.example.com`,
    runCommand: runCommand as SandboxInstance["runCommand"],
    writeFiles: async (files: SandboxFile[]) => {
      if (opts.writeError) throw new Error(opts.writeError)
      if (opts.written) opts.written.push(...files)
    },
    readFileToBuffer: notUsed("readFileToBuffer") as never,
    extendTimeout: async () => {},
    snapshot: notUsed("snapshot") as never,
    delete: async () => {},
  }
}

const GH_TOKEN = "ghp_0123456789abcdefABCDEF0123456789abcd"

beforeEach(() => {
  vi.clearAllMocks()
  fake.reset()
  fake.createCalls.length = 0
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

describe("installClaudeCode", () => {
  it("returns success when the global install exits 0", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 })))

    const result = await installClaudeCode("sandbox-a")

    expect(result).toEqual({ success: true, value: undefined })
  })

  it("reports failure truthfully when the global install exits non-zero", async () => {
    fake.setInstance(
      fakeSandbox((cmd, args) =>
        isClaudeInstall(cmd, args)
          ? { exitCode: 1, stderr: "npm ERR! network timeout" }
          : { exitCode: 0 },
      ),
    )

    const result = await installClaudeCode("sandbox-a")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toContain("npm ERR! network timeout")
  })

  it("redacts a GitHub token out of an install failure", async () => {
    fake.setInstance(
      fakeSandbox((cmd, args) =>
        isClaudeInstall(cmd, args)
          ? { exitCode: 1, stderr: `install failed using ${GH_TOKEN}` }
          : { exitCode: 0 },
      ),
    )

    const result = await installClaudeCode("sandbox-a")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
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
