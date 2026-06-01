import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type {
  HibernatingSandbox,
  SandboxCommandResult,
  SandboxCreateOptions,
  SandboxGetOptions,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"
import type { RepoData } from "@/lib/types"

// The lifecycle actions resolve (or create) the live instance through the
// provider seam. A fake provider — scripted, no real VM — stands in for Vercel
// Sandbox so we exercise the real action + runner code path. `vi.hoisted` lets
// the mock factory below close over mutable holders we rescript per test.
const fake = vi.hoisted(() => {
  let getInstance: SandboxInstance | null = null
  let getError: unknown = null
  let createInstance: SandboxInstance | null = null
  let createError: unknown = null
  const getCalls: SandboxGetOptions[] = []
  const createCalls: SandboxCreateOptions[] = []
  const provider: SandboxProvider = {
    get: vi.fn(async (opts: SandboxGetOptions) => {
      getCalls.push(opts)
      if (getError) throw getError
      if (!getInstance) throw new Error("test did not set a fake get instance")
      return getInstance
    }),
    create: vi.fn(async (opts: SandboxCreateOptions) => {
      createCalls.push(opts)
      if (createError) throw createError
      if (!createInstance) throw new Error("test did not set a fake create instance")
      return createInstance
    }),
  }
  return {
    provider,
    getCalls,
    createCalls,
    setGet: (i: SandboxInstance) => {
      getInstance = i
      getError = null
    },
    setGetError: (e: unknown) => {
      getError = e
    },
    setCreate: (i: SandboxInstance) => {
      createInstance = i
      createError = null
    },
    setCreateError: (e: unknown) => {
      createError = e
    },
    reset: () => {
      getInstance = null
      getError = null
      createInstance = null
      createError = null
      getCalls.length = 0
      createCalls.length = 0
    },
  }
})

// The mock replaces the provider singleton with the fake but keeps the real
// `supportsHibernation` guard — the branching under test keys on it, so faking
// the guard would defeat the point. Its detection (presence of `isRunning`)
// mirrors `lib/sandbox/types.ts`.
vi.mock("@/lib/sandbox", () => ({
  sandboxProvider: fake.provider,
  supportsHibernation: (s: { isRunning?: unknown }) => typeof s?.isRunning === "function",
  isSandboxRunning: (s: { isRunning?: () => boolean }) =>
    typeof s?.isRunning === "function" ? s.isRunning() : true,
}))

// restartSandbox folds the provider registry into the sandbox network policy.
// Stub it to an empty set — the egress policy is covered by
// network-policy.test.ts, and the real registry drags in the kv/db chain.
vi.mock("@/lib/agent/providers", () => ({ getModelProviders: () => [] }))

// restartSandbox falls back to the session's GitHub token; reconnect/restart
// read persisted repo env. Both need a request context / KV we don't have
// under plain Node — stub them so the action's create + result shaping is what's
// under test.
const getGitHubToken = vi.hoisted(() => vi.fn(async () => null as string | null))
vi.mock("@/lib/auth-helpers", () => ({ getGitHubToken }))

const getEnvVars = vi.hoisted(() => vi.fn(async () => undefined as Record<string, string> | undefined))
const deleteEnvVars = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/env-store", () => ({ getEnvVars, deleteEnvVars }))

// restartSandbox's fresh-provision path delegates git setup and the Claude Code
// install to the other action modules. Those are exercised by their own tests —
// here they're external boundaries, faked so the restart's branching + result
// shaping is what's pinned.
const configureAgentGit = vi.hoisted(() => vi.fn(async () => ({ success: true, value: undefined }) as { success: boolean; error?: string; value?: undefined }))
vi.mock("@/lib/sandbox/git", () => ({ configureAgentGit }))

const installClaudeCode = vi.hoisted(() => vi.fn(async () => ({ success: true, value: undefined })))
vi.mock("@/lib/sandbox/provision", () => ({ installClaudeCode }))

// The bridge module ships large generated scripts; stub the constants so the
// test pins the action's launch + result behavior, not the bundled payload.
vi.mock("@/lib/sandbox-bridge", () => ({
  PROXY_JS: "proxy",
  BRIDGE_JS: "bridge",
  BRIDGE_VERSION: "v-test",
}))

import {
  keepAliveSandbox,
  probeSandboxUrl,
  reconnectSandbox,
  removeSandboxEnv,
  restartSandbox,
} from "@/lib/sandbox/lifecycle"

type Scripted = { exitCode: number; stdout?: string; stderr?: string }

/**
 * Builds a fake {@link SandboxInstance}. `runCommand` is scripted by `respond`;
 * `snapshot` returns a scripted id (or throws); `extendTimeout` is a spy so the
 * keep-alive path can be asserted. Only the surface the actions touch is
 * implemented — everything else throws so an accidental dependency is loud.
 *
 * `hibernating` (default `true`, mirroring Vercel) controls whether the
 * instance advertises the hibernation capability: a hibernating fake carries
 * `isRunning()` / `snapshot()` / `extendTimeout()` (the guard keys on
 * `isRunning`); a non-hibernating one omits all three, so any hibernation call
 * on the portable path is a hard error and the tests prove the reclone-fresh
 * branch was taken instead.
 */
function fakeSandbox(
  opts: {
    name?: string
    status?: string
    hibernating?: boolean
    respond?: (cmd: string, args: string[]) => Scripted
    snapshotId?: string
    snapshotError?: boolean
    writeError?: string
    extendTimeout?: (ms: number) => void
  } = {},
): SandboxInstance {
  const hibernating = opts.hibernating ?? true
  const status = opts.status ?? "running"
  const respond: (cmd: string, args: string[]) => Scripted = opts.respond ?? (() => ({ exitCode: 0 }))
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
  const sandbox: SandboxInstance = {
    name: opts.name ?? "fake-sandbox",
    worktreePath: "/vercel/sandbox",
    homeDir: "/root",
    domain: (port: number) => `https://fake-${port}.example.com`,
    runCommand: runCommand as SandboxInstance["runCommand"],
    writeFiles: async () => {
      if (opts.writeError) throw new Error(opts.writeError)
    },
    readFileToBuffer: notUsed("readFileToBuffer") as never,
    delete: async () => {},
  }
  // A hibernating fake (default, mirroring Vercel) advertises the capability by
  // carrying isRunning()/snapshot()/extendTimeout(); a portable one omits them
  // entirely. With those methods off the core, a stray hibernation call on the
  // portable path is a hard error rather than a silent no-op, so the tests prove
  // the reclone-fresh branch was taken instead.
  if (hibernating) {
    const h = sandbox as HibernatingSandbox
    h.isRunning = () => status === "running"
    h.extendTimeout = async (ms: number) => {
      opts.extendTimeout?.(ms)
    }
    h.snapshot = async () => {
      if (opts.snapshotError) throw new Error("snapshot failed")
      return { snapshotId: opts.snapshotId ?? "snap-1" }
    }
  }
  return sandbox
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

beforeEach(() => {
  vi.clearAllMocks()
  fake.reset()
  configureAgentGit.mockResolvedValue({ success: true, value: undefined })
  installClaudeCode.mockResolvedValue({ success: true, value: undefined })
  getEnvVars.mockResolvedValue(undefined)
  getGitHubToken.mockResolvedValue(null)
})

describe("keepAliveSandbox", () => {
  it("extends the timeout and returns success when the sandbox is running", async () => {
    const extended: number[] = []
    fake.setGet(fakeSandbox({ status: "running", extendTimeout: (ms) => extended.push(ms) }))

    const result = await keepAliveSandbox("sandbox-a")

    expect(result).toEqual({ success: true, value: undefined })
    // Resolved without resuming a stopped VM, and the timer was actually bumped.
    expect(fake.getCalls[0]).toEqual({ name: "sandbox-a", resume: false })
    expect(extended).toHaveLength(1)
  })

  it("reports failure without extending when the sandbox is not running", async () => {
    const extended: number[] = []
    fake.setGet(fakeSandbox({ status: "stopped", extendTimeout: (ms) => extended.push(ms) }))

    const result = await keepAliveSandbox("sandbox-a")

    expect(result.success).toBe(false)
    expect(extended).toHaveLength(0)
  })

  it("returns a redacted failure when resolving the sandbox throws", async () => {
    fake.setGetError(new Error(`provider rejected token ${GH_TOKEN}`))

    const result = await keepAliveSandbox("sandbox-a")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })

  it("is a clean no-op on a non-hibernating provider (no timer to extend)", async () => {
    // The fake's extendTimeout throws if reached — success here proves keep-alive
    // never touched a hibernation method on the portable provider.
    fake.setGet(fakeSandbox({ hibernating: false, status: "running" }))

    const result = await keepAliveSandbox("sandbox-a")

    expect(result).toEqual({ success: true, value: undefined })
  })
})

describe("removeSandboxEnv", () => {
  it("deletes the persisted env vars for the sandbox", async () => {
    await removeSandboxEnv("sandbox-a")

    expect(deleteEnvVars).toHaveBeenCalledWith("sandbox-a")
  })
})

describe("restartSandbox", () => {
  it("boots from a snapshot and relaunches without re-provisioning", async () => {
    fake.setGet(fakeSandbox({ snapshotId: "snap-1" }))
    fake.setCreate(fakeSandbox({ name: "sandbox-a" }))

    const result = await restartSandbox("sandbox-a", repo, "feature")

    expect(result).toEqual({
      success: true,
      value: { sandboxName: "sandbox-a", previewDomain: "https://fake-4000.example.com" },
    })
    // New VM booted from the captured snapshot…
    expect(fake.createCalls[0]!.source).toEqual({ type: "snapshot", snapshotId: "snap-1" })
    // …so the install/git pipeline is skipped entirely.
    expect(configureAgentGit).not.toHaveBeenCalled()
  })

  it("falls back to a fresh git clone + provision when no snapshot is captured", async () => {
    // Snapshotting the old VM fails, so the new one is cloned from git and the
    // full setup pipeline runs.
    fake.setGet(fakeSandbox({ snapshotError: true }))
    fake.setCreate(fakeSandbox({ name: "sandbox-a" }))

    const result = await restartSandbox("sandbox-a", repo, "feature")

    expect(result).toEqual({
      success: true,
      value: { sandboxName: "sandbox-a", previewDomain: "https://fake-4000.example.com" },
    })
    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/octocat/hello-world.git",
      revision: "feature",
    })
    expect(configureAgentGit).toHaveBeenCalledWith("sandbox-a", repo, "feature")
  })

  it("returns a failure when the setup script exits non-zero on the fresh path", async () => {
    fake.setGet(fakeSandbox({ snapshotError: true }))
    fake.setCreate(fakeSandbox({ name: "sandbox-a", respond: () => ({ exitCode: 1 }) }))

    const result = await restartSandbox("sandbox-a", repo, "feature")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toContain("Setup script failed")
    // Bailed before configuring git.
    expect(configureAgentGit).not.toHaveBeenCalled()
  })

  it("returns a redacted failure when creating the new sandbox throws", async () => {
    fake.setGet(fakeSandbox({ snapshotError: true }))
    fake.setCreateError(new Error(`provider rejected token ${GH_TOKEN}`))

    const result = await restartSandbox("sandbox-a", repo, "feature")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })

  it("reclones fresh on a non-hibernating provider without ever snapshotting", async () => {
    // The old instance can't hibernate (its snapshot() throws if reached), so the
    // restart skips snapshot/restore and reclones from git instead.
    fake.setGet(fakeSandbox({ hibernating: false }))
    fake.setCreate(fakeSandbox({ name: "sandbox-a" }))

    const result = await restartSandbox("sandbox-a", repo, "feature")

    expect(result).toEqual({
      success: true,
      value: { sandboxName: "sandbox-a", previewDomain: "https://fake-4000.example.com" },
    })
    // Took the reclone-fresh branch: created from a git source and ran the
    // full provision pipeline rather than booting from a snapshot.
    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/octocat/hello-world.git",
      revision: "feature",
    })
    expect(configureAgentGit).toHaveBeenCalledWith("sandbox-a", repo, "feature")
  })
})

describe("reconnectSandbox", () => {
  it("returns the running preview without relaunching when the sandbox is already up", async () => {
    fake.setGet(fakeSandbox({ status: "running" }))

    const result = await reconnectSandbox("sandbox-a", repo)

    // Preview points at the proxy port (devserver port + 1000), and the action
    // took the early branch — a single resume:false probe, no second resolve to
    // relaunch a dev server that's already running.
    expect(result).toEqual({
      success: true,
      value: { sandboxName: "fake-sandbox", previewDomain: "https://fake-4000.example.com" },
    })
    expect(fake.getCalls).toHaveLength(1)
    expect(fake.getCalls[0]).toEqual({ name: "sandbox-a", resume: false })
  })

  it("resumes and relaunches the dev server when a hibernating sandbox has stopped", async () => {
    fake.setGet(fakeSandbox({ status: "stopped" }))

    const result = await reconnectSandbox("sandbox-a", repo)

    expect(result).toEqual({
      success: true,
      value: { sandboxName: "fake-sandbox", previewDomain: "https://fake-4000.example.com" },
    })
    // Probed without resuming, then resolved again to relaunch — no reclone.
    expect(fake.getCalls).toHaveLength(2)
    expect(fake.getCalls[0]).toEqual({ name: "sandbox-a", resume: false })
    expect(fake.createCalls).toHaveLength(0)
  })

  it("reuses the live handle on a non-hibernating provider (live while the handle exists)", async () => {
    // A portable provider has no stopped-but-present state: its handle is live
    // for as long as it exists, so the portable predicate reports it running and
    // reconnect reuses it — no resume (which means nothing here) and no reclone.
    fake.setGet(fakeSandbox({ hibernating: false }))

    const result = await reconnectSandbox("sandbox-a", repo)

    expect(result).toEqual({
      success: true,
      value: { sandboxName: "fake-sandbox", previewDomain: "https://fake-4000.example.com" },
    })
    // A single probe, no second resolve, and crucially no create — the handle
    // was reused rather than recloned.
    expect(fake.getCalls).toHaveLength(1)
    expect(fake.getCalls[0]).toEqual({ name: "sandbox-a", resume: false })
    expect(fake.createCalls).toHaveLength(0)
  })

  it("returns a redacted failure when the resume + relaunch throws", async () => {
    // First probe sees a stopped VM; the runner then resolves it and relaunches
    // the dev server, and that relaunch throws with a token in the message.
    fake.setGet(fakeSandbox({ status: "stopped", writeError: `relaunch failed using ${GH_TOKEN}` }))

    const result = await reconnectSandbox("sandbox-a", repo)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })

  it("returns a redacted failure when the initial probe throws", async () => {
    fake.setGetError(new Error(`resolve failed using ${GH_TOKEN}`))

    const result = await reconnectSandbox("sandbox-a", repo)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })
})

describe("probeSandboxUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns true when the proxy serves real HTML markup", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, text: async () => "<html><body>hi</body></html>" })),
    )

    expect(await probeSandboxUrl("https://x.example.com")).toBe(true)
  })

  it("returns false for an empty placeholder page with no markup", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: async () => "   " })))

    expect(await probeSandboxUrl("https://x.example.com")).toBe(false)
  })

  it("returns false on a non-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, text: async () => "<body>" })))

    expect(await probeSandboxUrl("https://x.example.com")).toBe(false)
  })

  it("returns false when the request throws (sandbox not reachable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED")
      }),
    )

    expect(await probeSandboxUrl("https://x.example.com")).toBe(false)
  })
})
