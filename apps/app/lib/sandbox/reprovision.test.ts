import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { ModelProvider } from "@/lib/agent/providers"
import type {
  SandboxCommandResult,
  SandboxCreateOptions,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"
import type { RepoData } from "@/lib/types"

// reprovisionFromGit *creates* the live instance through the provider seam. A
// fake provider — scripted, no real VM — stands in for Vercel Sandbox so we
// exercise the real action code path. `vi.hoisted` lets the mock factory below
// close over a mutable holder we rescript per test.
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

// The action folds the provider registry into the sandbox network policy and
// resolves the selected harnesses' brokers from it. Stub it with a configured
// Anthropic provider (claude-code's broker) so the brokered-env fold emits the
// gate var — the egress policy itself is covered by network-policy.test.ts.
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

// reprovisionFromGit falls back to the session's GitHub token when none is
// passed. That needs a request context we don't have under plain Node — stub it
// so the action's create + result shaping is what's under test.
const getGitHubToken = vi.hoisted(() =>
  vi.fn(async () => null as string | null)
)
vi.mock("@/lib/auth-helpers", () => ({ getGitHubToken }))

// Git setup and the harness install live in their own action modules,
// exercised by their own tests. Here they're external boundaries — faked so the
// reprovision pipeline's branching + result shaping is what's pinned.
const configureAgentGit = vi.hoisted(() =>
  vi.fn(
    async () =>
      ({ success: true, value: undefined }) as {
        success: boolean
        error?: string
        value?: undefined
      }
  )
)
vi.mock("@/lib/sandbox/git", () => ({ configureAgentGit }))

const installHarnesses = vi.hoisted(() =>
  vi.fn(async () => ({ success: true, value: undefined }))
)
vi.mock("@/lib/sandbox/provision", () => ({ installHarnesses }))

// The bridge module ships large generated scripts; stub the constants so the
// test pins the action's launch + result behavior, not the bundled payload.
vi.mock("@/lib/sandbox-bridge", () => ({
  PROXY_JS: "proxy",
  BRIDGE_JS: "bridge",
  BRIDGE_VERSION: "v-test",
}))

import { reprovisionFromGit } from "@/lib/sandbox/reprovision"

type Scripted = { exitCode: number; stdout?: string; stderr?: string }

/**
 * Builds a fake {@link SandboxInstance} whose `runCommand` is scripted by
 * `respond(cmd, args)`. Only the surface the action touches is implemented;
 * everything else throws so an accidental dependency is loud.
 */
function fakeSandbox(
  opts: {
    name?: string
    respond?: (cmd: string, args: string[]) => Scripted
    writeError?: string
  } = {}
): SandboxInstance {
  const respond: (cmd: string, args: string[]) => Scripted =
    opts.respond ?? (() => ({ exitCode: 0 }))
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
    name: opts.name ?? "fake-sandbox",
    worktreePath: "/vercel/sandbox",
    homeDir: "/home/vercel-sandbox",
    domain: (port: number) => `https://fake-${port}.example.com`,
    hostPort: (port: number) => port,
    runCommand: runCommand as SandboxInstance["runCommand"],
    writeFiles: async () => {
      if (opts.writeError) throw new Error(opts.writeError)
    },
    readFileToBuffer: notUsed("readFileToBuffer") as never,
    delete: async () => {},
  }
}

const GH_TOKEN = "ghp_0123456789abcdefABCDEF0123456789abcd"

const repo = {
  cloneUrl: "https://github.com/octocat/hello-world.git",
  devServerPort: 3000,
  devScript: "npm run dev",
  setupScript: "npm install",
  repoOwner: "octocat",
  repoName: "hello-world",
} as RepoData

let savedHarnesses: string | undefined

beforeEach(() => {
  vi.clearAllMocks()
  fake.reset()
  fake.createCalls.length = 0
  backend.hostGitAuth = false
  configureAgentGit.mockResolvedValue({ success: true, value: undefined })
  installHarnesses.mockResolvedValue({ success: true, value: undefined })
  getGitHubToken.mockResolvedValue(null)
  getModelProviders.mockReturnValue([configuredAnthropic()])
  // The deployment under test selects Claude Code; the brokered-env + install
  // folds key off this var.
  savedHarnesses = process.env.SANDBOX_HARNESSES
  process.env.SANDBOX_HARNESSES = "claude-code"
})

afterEach(() => {
  if (savedHarnesses === undefined) delete process.env.SANDBOX_HARNESSES
  else process.env.SANDBOX_HARNESSES = savedHarnesses
})

describe("reprovisionFromGit", () => {
  it("clones from git, provisions, and returns the proxy preview domain", async () => {
    fake.setInstance(fakeSandbox({ name: "sandbox-a" }))

    const result = await reprovisionFromGit(
      "sandbox-a",
      repo,
      "feature",
      "tok123"
    )

    // Preview points at the proxy port (devserver port + 1000), not the
    // devserver port itself.
    expect(result).toEqual({
      success: true,
      value: {
        sandboxName: "sandbox-a",
        previewDomain: "https://fake-4000.example.com",
      },
    })
    // VM was created from a token-authed git source on the requested branch…
    expect(fake.createCalls).toHaveLength(1)
    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/octocat/hello-world.git",
      revision: "feature",
      username: "x-access-token",
      password: "tok123",
    })
    // …and the dev/proxy + terminal ports are forwarded.
    expect(fake.createCalls[0]!.ports).toEqual([3000, 4000, 7681])
    // …then the full provision pipeline ran against the created VM, installing
    // the selected harness keys.
    expect(installHarnesses).toHaveBeenCalledWith("sandbox-a", ["claude-code"])
    expect(configureAgentGit).toHaveBeenCalledWith("sandbox-a", repo, "feature")
  })

  it("clones via host auth on the local backend, never baking the token into the source", async () => {
    // The local backend clones as a host process through the user's own git
    // credentials, so even a passed token must not be spliced into the clone URL.
    backend.hostGitAuth = true
    fake.setInstance(fakeSandbox({ name: "sandbox-a" }))

    await reprovisionFromGit("sandbox-a", repo, "feature", "tok123")

    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/octocat/hello-world.git",
      revision: "feature",
    })
  })

  it("clones without auth, falling back to the session token when none is passed", async () => {
    // getGitHubToken stays null (the default), so the source carries no creds.
    fake.setInstance(fakeSandbox({ name: "sandbox-a" }))

    await reprovisionFromGit("sandbox-a", repo, "feature")

    expect(getGitHubToken).toHaveBeenCalled()
    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/octocat/hello-world.git",
      revision: "feature",
    })
  })

  it("merges the brokered Anthropic env with the passed repo env", async () => {
    fake.setInstance(fakeSandbox({ name: "sandbox-a" }))

    await reprovisionFromGit("sandbox-a", repo, "feature", "tok", {
      FOO: "bar",
    })

    expect(fake.createCalls[0]!.env).toEqual({
      ANTHROPIC_API_KEY: "brokered",
      FOO: "bar",
    })
  })

  it("returns a failure when the setup script exits non-zero, before configuring git", async () => {
    fake.setInstance(
      fakeSandbox({ name: "sandbox-a", respond: () => ({ exitCode: 1 }) })
    )

    const result = await reprovisionFromGit("sandbox-a", repo, "feature", "tok")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toContain("Setup script failed")
    // Bailed before configuring git and launching the dev server.
    expect(configureAgentGit).not.toHaveBeenCalled()
  })

  it("returns a failure when git configuration fails", async () => {
    fake.setInstance(fakeSandbox({ name: "sandbox-a" }))
    configureAgentGit.mockResolvedValue({
      success: false,
      error: "git remote set-url failed",
    })

    const result = await reprovisionFromGit("sandbox-a", repo, "feature", "tok")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toContain("git remote set-url failed")
  })

  it("redacts a GitHub token out of a git-config failure", async () => {
    fake.setInstance(fakeSandbox({ name: "sandbox-a" }))
    configureAgentGit.mockResolvedValue({
      success: false,
      error: `push failed using ${GH_TOKEN}`,
    })

    const result = await reprovisionFromGit("sandbox-a", repo, "feature", "tok")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })

  it("returns a redacted failure when creating the sandbox throws", async () => {
    fake.setCreateError(new Error(`provider rejected token ${GH_TOKEN}`))

    const result = await reprovisionFromGit("sandbox-a", repo, "feature", "tok")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })
})
