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
      if (!createInstance)
        throw new Error("test did not set a fake create instance")
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
  // These lifecycle tests pin the hosted (Vercel) reclone path, which brokers the
  // git token — the local backend's host-native auth is exercised in
  // reprovision.test.ts / provision.test.ts.
  usesHostGitAuth: false,
  supportsHibernation: (s: { isRunning?: unknown }) =>
    typeof s?.isRunning === "function",
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
const getGitHubToken = vi.hoisted(() =>
  vi.fn(async () => null as string | null)
)
vi.mock("@/lib/auth-helpers", () => ({ getGitHubToken }))

const getEnvVars = vi.hoisted(() =>
  vi.fn(async () => undefined as Record<string, string> | undefined)
)
const deleteEnvVars = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/env-store", () => ({ getEnvVars, deleteEnvVars }))

// restartSandbox's fresh-provision path delegates git setup and the harness
// install to the other action modules. Those are exercised by their own tests —
// here they're external boundaries, faked so the restart's branching + result
// shaping is what's pinned.
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

import {
  ensurePreviewLive,
  keepAliveSandbox,
  probeSandboxUrl,
  reconnectSandbox,
  recreateSandbox,
  removeSandboxEnv,
  restartDevServer,
  restartSandbox,
  stopDevServers,
} from "@/lib/sandbox/lifecycle"

/** Stub global fetch so the reachability probe lands on a chosen branch. */
function stubProbe(reachable: boolean) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      if (!reachable) throw new Error("ECONNREFUSED")
      // The proxy answers with a 2xx once the dev server is up; the probe only
      // looks at the status, not the body.
      return { status: 200 }
    })
  )
}

/**
 * Stub global fetch with a per-call probe script, the last state repeating:
 *  - `"ready"` — the dev server answered (2xx).
 *  - `"refused"` — the proxy answered with its placeholder, marking the
 *    upstream connection as refused (the proxy.mjs headers).
 *  - `"down"` — nothing listening at all (fetch rejects).
 */
function stubProbeStates(states: ("ready" | "refused" | "down")[]) {
  let call = 0
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const state = states[Math.min(call++, states.length - 1)]
      if (state === "down") throw new Error("ECONNREFUSED")
      if (state === "ready") return { status: 200 }
      return {
        status: 503,
        headers: new Headers({
          "x-screenplay-proxy": "placeholder",
          "x-screenplay-upstream-error": "ECONNREFUSED",
        }),
      }
    })
  )
}

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
    onWriteFiles?: () => void
    extendTimeout?: (ms: number) => void
    /** Port seam override; identity (the hosted behavior) by default. */
    hostPort?: (port: number) => number
  } = {}
): SandboxInstance {
  const hibernating = opts.hibernating ?? true
  const status = opts.status ?? "running"
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
  const sandbox: SandboxInstance = {
    name: opts.name ?? "fake-sandbox",
    worktreePath: "/vercel/sandbox",
    homeDir: "/home/vercel-sandbox",
    domain: (port: number) => `https://fake-${port}.example.com`,
    hostPort: opts.hostPort ?? ((port: number) => port),
    runCommand: runCommand as SandboxInstance["runCommand"],
    writeFiles: async () => {
      // launchDevAndProxy writes the bridge files first, so a writeFiles call is
      // the signal that a relaunch happened — tests assert on it to tell the
      // probe's fast path (no relaunch) from the dead-preview path (relaunch).
      opts.onWriteFiles?.()
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
  installHarnesses.mockResolvedValue({ success: true, value: undefined })
  getEnvVars.mockResolvedValue(undefined)
  getGitHubToken.mockResolvedValue(null)
})

describe("stopDevServers", () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("group-kills each sandbox's dev/proxy supervisors on the local backend", async () => {
    vi.stubEnv("SANDBOX_BACKEND", "local")
    const shCalls: string[] = []
    fake.setGet(
      fakeSandbox({
        respond: (cmd, args) => {
          if (cmd === "sh") shCalls.push(args.join(" "))
          return { exitCode: 0 }
        },
      })
    )

    await stopDevServers(["sandbox-a", "sandbox-b"])

    // One stop per name, each resolving the live handle without resuming —
    // a leave-triggered stop must never wake anything.
    expect(fake.getCalls).toEqual([
      { name: "sandbox-a", resume: false },
      { name: "sandbox-b", resume: false },
    ])
    expect(shCalls).toHaveLength(2)
    for (const sh of shCalls) {
      // The same pidfile group-kill the relaunch path uses: the whole setsid
      // session goes down (supervisor loop, dev server, compile workers).
      expect(sh).toContain('kill -KILL "-$p"')
      expect(sh).toContain("dev.pid")
      expect(sh).toContain("proxy.pid")
    }
  })

  it("is a silent no-op on the hosted backend (collaborators keep their previews)", async () => {
    fake.setGet(fakeSandbox())

    await stopDevServers(["sandbox-a"])

    expect(fake.getCalls).toHaveLength(0)
  })

  it("never throws when a sandbox is gone — leaving must not be blocked", async () => {
    vi.stubEnv("SANDBOX_BACKEND", "local")
    fake.setGetError(new Error("no sandbox by that name"))

    await expect(stopDevServers(["sandbox-a"])).resolves.toBeUndefined()
  })
})

describe("keepAliveSandbox", () => {
  it("extends the timeout and returns success when the sandbox is running", async () => {
    const extended: number[] = []
    fake.setGet(
      fakeSandbox({
        status: "running",
        extendTimeout: (ms) => extended.push(ms),
      })
    )

    const result = await keepAliveSandbox("sandbox-a")

    expect(result).toEqual({ success: true, value: undefined })
    // Resolved without resuming a stopped VM, and the timer was actually bumped.
    expect(fake.getCalls[0]).toEqual({ name: "sandbox-a", resume: false })
    expect(extended).toHaveLength(1)
  })

  it("reports failure without extending when the sandbox is not running", async () => {
    const extended: number[] = []
    fake.setGet(
      fakeSandbox({
        status: "stopped",
        extendTimeout: (ms) => extended.push(ms),
      })
    )

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

    const result = await restartSandbox("sandbox-a", repo)

    expect(result).toEqual({
      success: true,
      value: {
        sandboxName: "sandbox-a",
        previewDomain: "https://fake-4000.example.com",
      },
    })
    // New VM booted from the captured snapshot…
    expect(fake.createCalls[0]!.source).toEqual({
      type: "snapshot",
      snapshotId: "snap-1",
    })
    // …so the install/git pipeline is skipped entirely.
    expect(configureAgentGit).not.toHaveBeenCalled()
  })

  it("fails loud on a snapshot miss instead of recloning", async () => {
    // Snapshotting the old VM fails. The silent reclone fallback was removed, so
    // the restart must report a failure — never create a fresh git-sourced VM —
    // so uncommitted work is never quietly discarded.
    fake.setGet(fakeSandbox({ snapshotError: true }))
    fake.setCreate(fakeSandbox({ name: "sandbox-a" }))

    const result = await restartSandbox("sandbox-a", repo)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toMatch(/recreate from scratch/i)
    // Crucially: no reclone. No VM was created and the provision pipeline never
    // ran.
    expect(fake.createCalls).toHaveLength(0)
    expect(configureAgentGit).not.toHaveBeenCalled()
  })

  it("fails loud on a non-hibernating provider without snapshotting or recloning", async () => {
    // The old instance can't hibernate (its snapshot() throws if reached), so no
    // snapshot is captured. With the fallback gone this fails rather than
    // recloning — preserving the working tree is impossible, so it refuses
    // rather than destroying it silently.
    fake.setGet(fakeSandbox({ hibernating: false }))
    fake.setCreate(fakeSandbox({ name: "sandbox-a" }))

    const result = await restartSandbox("sandbox-a", repo)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toMatch(/recreate from scratch/i)
    expect(fake.createCalls).toHaveLength(0)
    expect(configureAgentGit).not.toHaveBeenCalled()
  })

  it("returns a redacted failure when booting from the snapshot throws", async () => {
    // Snapshot captured fine, but creating the new VM from it throws with a
    // token in the message — the single catch must redact it.
    fake.setGet(fakeSandbox({ snapshotId: "snap-1" }))
    fake.setCreateError(new Error(`provider rejected token ${GH_TOKEN}`))

    const result = await restartSandbox("sandbox-a", repo)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })
})

describe("recreateSandbox", () => {
  it("reclones fresh from git and runs the full provision pipeline", async () => {
    // The old VM is fetched and deleted to free the name, then a new one is
    // cloned from git with the whole setup pipeline.
    fake.setGet(fakeSandbox({ name: "sandbox-a" }))
    fake.setCreate(fakeSandbox({ name: "sandbox-a" }))

    const result = await recreateSandbox("sandbox-a", repo, "feature")

    expect(result).toEqual({
      success: true,
      value: {
        sandboxName: "sandbox-a",
        previewDomain: "https://fake-4000.example.com",
      },
    })
    // Created from a git source and the git/setup pipeline ran — never a
    // snapshot restore.
    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/octocat/hello-world.git",
      revision: "feature",
    })
    expect(configureAgentGit).toHaveBeenCalledWith("sandbox-a", repo, "feature")
  })

  it("still reclones when the old sandbox is already gone", async () => {
    // Freeing the name is best-effort: a missing old VM (e.g. expired snapshot)
    // must not block the recreate — it just clones fresh.
    fake.setGetError(new Error("sandbox not found"))
    fake.setCreate(fakeSandbox({ name: "sandbox-a" }))

    const result = await recreateSandbox("sandbox-a", repo, "feature")

    expect(result.success).toBe(true)
    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/octocat/hello-world.git",
      revision: "feature",
    })
  })

  it("returns a failure when the setup script exits non-zero", async () => {
    fake.setGet(fakeSandbox({ name: "sandbox-a" }))
    fake.setCreate(
      fakeSandbox({ name: "sandbox-a", respond: () => ({ exitCode: 1 }) })
    )

    const result = await recreateSandbox("sandbox-a", repo, "feature")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toContain("Setup script failed")
    expect(configureAgentGit).not.toHaveBeenCalled()
  })

  it("returns a redacted failure when creating the new sandbox throws", async () => {
    fake.setGet(fakeSandbox({ name: "sandbox-a" }))
    fake.setCreateError(new Error(`provider rejected token ${GH_TOKEN}`))

    const result = await recreateSandbox("sandbox-a", repo, "feature")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })
})

describe("restartDevServer", () => {
  it("bounces the dev server in place without ever cycling the VM", async () => {
    // launchDevAndProxy writes the bridge files first, so a writeFiles call is
    // the signal the dev server was relaunched.
    let relaunched = false
    fake.setGet(
      fakeSandbox({
        status: "running",
        onWriteFiles: () => (relaunched = true),
      })
    )

    const result = await restartDevServer("sandbox-a", repo)

    expect(result).toEqual({
      success: true,
      value: { previewDomain: "https://fake-4000.example.com" },
    })
    // Resolved the live handle without resuming, relaunched through it…
    expect(fake.getCalls).toHaveLength(1)
    expect(fake.getCalls[0]).toEqual({ name: "sandbox-a", resume: false })
    expect(relaunched).toBe(true)
    // …and, crucially, never created a new VM — the operation does not cycle
    // the VM (filesystem and working tree untouched).
    expect(fake.createCalls).toHaveLength(0)
  })

  it("reuses the live handle on a non-hibernating provider (no VM cycle)", async () => {
    // A portable provider has no stopped-but-present state — its handle is live
    // while it exists — so the bounce runs against it directly, still no create.
    let relaunched = false
    fake.setGet(
      fakeSandbox({
        hibernating: false,
        onWriteFiles: () => (relaunched = true),
      })
    )

    const result = await restartDevServer("sandbox-a", repo)

    expect(result).toEqual({
      success: true,
      value: { previewDomain: "https://fake-4000.example.com" },
    })
    expect(relaunched).toBe(true)
    expect(fake.createCalls).toHaveLength(0)
  })

  it("fails without relaunching or cycling when the VM is not running", async () => {
    let relaunched = false
    fake.setGet(
      fakeSandbox({
        status: "stopped",
        onWriteFiles: () => (relaunched = true),
      })
    )

    const result = await restartDevServer("sandbox-a", repo)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toContain("not running")
    // No relaunch, and still no VM cycle — waking a stopped VM is restartSandbox's
    // job, not the dev-server bounce's.
    expect(relaunched).toBe(false)
    expect(fake.createCalls).toHaveLength(0)
  })

  it("returns a redacted failure when the relaunch throws", async () => {
    fake.setGet(
      fakeSandbox({
        status: "running",
        writeError: `relaunch failed using ${GH_TOKEN}`,
      })
    )

    const result = await restartDevServer("sandbox-a", repo)

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })
})

describe("reconnectSandbox", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns the running preview without relaunching when the preview is reachable", async () => {
    // VM up and its preview answers, so the fast path returns the domain with no
    // relaunch of the dev server.
    let relaunched = false
    fake.setGet(
      fakeSandbox({
        status: "running",
        onWriteFiles: () => (relaunched = true),
      })
    )
    stubProbe(true)

    const result = await reconnectSandbox("sandbox-a", repo)

    // Preview points at the proxy port (devserver port + 1000), and the action
    // took the early branch — a single resume:false probe, no second resolve to
    // relaunch a dev server that's already running.
    expect(result).toEqual({
      success: true,
      value: {
        sandboxName: "fake-sandbox",
        previewDomain: "https://fake-4000.example.com",
      },
    })
    expect(fake.getCalls).toHaveLength(1)
    expect(fake.getCalls[0]).toEqual({ name: "sandbox-a", resume: false })
    // Reachable preview was left untouched — no dev-server relaunch.
    expect(relaunched).toBe(false)
  })

  it("relaunches the dev server and proxy when a live VM's preview is unreachable", async () => {
    // VM up but the dev server / bridge proxy has died: the probe fails, so the
    // reconnect self-heals by relaunching before returning the domain.
    let relaunched = false
    fake.setGet(
      fakeSandbox({
        status: "running",
        onWriteFiles: () => (relaunched = true),
      })
    )
    stubProbe(false)

    // Probe always fails, so ensurePreviewLive exhausts its retry budget before
    // relaunching. Fake timers fast-forward the inter-attempt delays so the test
    // doesn't actually sleep; runAllTimersAsync also flushes the awaited probes.
    vi.useFakeTimers()
    const pending = reconnectSandbox("sandbox-a", repo)
    await vi.runAllTimersAsync()
    const result = await pending
    vi.useRealTimers()

    expect(result).toEqual({
      success: true,
      value: {
        sandboxName: "fake-sandbox",
        previewDomain: "https://fake-4000.example.com",
      },
    })
    // Reused the live handle (single resume:false probe, no reclone) and
    // relaunched the dev server in place.
    expect(fake.getCalls).toHaveLength(1)
    expect(fake.getCalls[0]).toEqual({ name: "sandbox-a", resume: false })
    expect(fake.createCalls).toHaveLength(0)
    expect(relaunched).toBe(true)
  })

  it("resumes and relaunches the dev server when a hibernating sandbox has stopped", async () => {
    fake.setGet(fakeSandbox({ status: "stopped" }))

    const result = await reconnectSandbox("sandbox-a", repo)

    expect(result).toEqual({
      success: true,
      value: {
        sandboxName: "fake-sandbox",
        previewDomain: "https://fake-4000.example.com",
      },
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
    // Its preview answers, so the fast path returns without a relaunch.
    fake.setGet(fakeSandbox({ hibernating: false }))
    stubProbe(true)

    const result = await reconnectSandbox("sandbox-a", repo)

    expect(result).toEqual({
      success: true,
      value: {
        sandboxName: "fake-sandbox",
        previewDomain: "https://fake-4000.example.com",
      },
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
    fake.setGet(
      fakeSandbox({
        status: "stopped",
        writeError: `relaunch failed using ${GH_TOKEN}`,
      })
    )

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

describe("ensurePreviewLive", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns the preview domain untouched when it is already reachable", async () => {
    let relaunched = false
    const sandbox = fakeSandbox({ onWriteFiles: () => (relaunched = true) })
    stubProbe(true)

    const domain = await ensurePreviewLive(sandbox, 3000, "npm run dev")

    // Proxy port = dev port + 1000, handed back with no relaunch.
    expect(domain).toBe("https://fake-4000.example.com")
    expect(relaunched).toBe(false)
  })

  it("relaunches the dev server and proxy when every probe fails", async () => {
    let relaunched = false
    const sandbox = fakeSandbox({ onWriteFiles: () => (relaunched = true) })
    stubProbe(false)

    // probeDelayMs:0 keeps the retry loop instant; the default attempt count
    // still exhausts before giving up.
    const domain = await ensurePreviewLive(sandbox, 3000, "npm run dev", null, {
      probeDelayMs: 0,
    })

    // Every probe failed, so launchDevAndProxy ran (bridge files written) and
    // the freshly launched proxy's domain is returned.
    expect(domain).toBe("https://fake-4000.example.com")
    expect(relaunched).toBe(true)
  })

  it("rides out a transient probe failure without relaunching", async () => {
    let relaunched = false
    const sandbox = fakeSandbox({ onWriteFiles: () => (relaunched = true) })
    // First probe fails (slow cold start / transient blip), the next succeeds.
    let calls = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++
        if (calls === 1) throw new Error("ECONNREFUSED")
        return { status: 200 }
      })
    )

    const domain = await ensurePreviewLive(sandbox, 3000, "npm run dev", null, {
      probeDelayMs: 0,
    })

    // The retry found the server up, so no relaunch — the live server is left
    // running instead of being torn down and stacked over.
    expect(domain).toBe("https://fake-4000.example.com")
    expect(relaunched).toBe(false)
    expect(calls).toBe(2)
  })

  it("propagates a relaunch failure so the caller can redact it", async () => {
    const sandbox = fakeSandbox({ writeError: "relaunch boom" })
    stubProbe(false)

    await expect(
      ensurePreviewLive(sandbox, 3000, "npm run dev", null, { probeDelayMs: 0 })
    ).rejects.toThrow("relaunch boom")
  })

  // Ignored-port detection: a dev server that never binds the port portless
  // assigned it (a script ignoring $PORT, or portless failing to launch)
  // leaves the proxy up (it binds its resolved port fine) while the dev server
  // refuses every connection on the resolved dev port. Only meaningful where
  // logical ≠ bound — the local backend's mapped seam.
  const mappedPorts = (port: number) => port + 50000

  it("fails loud with the named error when the proxy is up but the mapped dev port never listens", async () => {
    let relaunched = false
    const sandbox = fakeSandbox({
      hostPort: mappedPorts,
      onWriteFiles: () => (relaunched = true),
    })
    stubProbeStates(["refused"])

    await expect(
      ensurePreviewLive(sandbox, 3000, "npm run dev", null, { probeDelayMs: 0 })
    ).rejects.toMatchObject({
      name: "DevServerPortIgnoredError",
      message: expect.stringContaining("portless"),
    })
    // Relaunching the same script onto the same wrong port can't fix it, so
    // nothing was relaunched — the failure surfaces instead of a dead iframe.
    expect(relaunched).toBe(false)
  })

  it("keeps relaunching on refused probes on an identity backend — hosted behavior unchanged", async () => {
    let relaunched = false
    const sandbox = fakeSandbox({ onWriteFiles: () => (relaunched = true) })
    stubProbeStates(["refused"])

    const domain = await ensurePreviewLive(sandbox, 3000, "npm run dev", null, {
      probeDelayMs: 0,
    })

    // On the hosted backend a default-port dev server IS on its assigned port,
    // so refused upstream just means it died — the relaunch self-heal applies.
    expect(domain).toBe("https://fake-4000.example.com")
    expect(relaunched).toBe(true)
  })

  it("relaunches a fully-dark preview on a mapped port and returns once it comes up", async () => {
    let relaunched = false
    const sandbox = fakeSandbox({
      hostPort: mappedPorts,
      onWriteFiles: () => (relaunched = true),
    })
    // First window (3 attempts): proxy itself is down — that's a dead launch,
    // not an ignored port. The relaunch window then finds the server up.
    stubProbeStates(["down", "down", "down", "ready"])

    const domain = await ensurePreviewLive(sandbox, 3000, "npm run dev", null, {
      probeDelayMs: 0,
    })

    expect(relaunched).toBe(true)
    expect(domain).toBe("https://fake-4000.example.com")
  })

  it("fails loud when the relaunch's dev server also never binds its mapped port", async () => {
    let relaunched = false
    const sandbox = fakeSandbox({
      hostPort: mappedPorts,
      onWriteFiles: () => (relaunched = true),
    })
    // First window: dark (proxy down) → relaunch. Second window: proxy up,
    // upstream refused on every attempt → the dev script ignored its port.
    stubProbeStates(["down", "down", "down", "refused"])

    await expect(
      ensurePreviewLive(sandbox, 3000, "npm run dev", null, { probeDelayMs: 0 })
    ).rejects.toMatchObject({ name: "DevServerPortIgnoredError" })
    expect(relaunched).toBe(true)
  })
})

describe("probeSandboxUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns true on a 2xx response (dev server answered)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 200 }))
    )

    expect(await probeSandboxUrl("https://x.example.com")).toBe(true)
  })

  it("treats a redirect as reachable without following it", async () => {
    // `redirect: "manual"` surfaces a 3xx as an opaque-redirect response. A
    // live server that redirects (e.g. "/" -> "/login") is still up.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 0, type: "opaqueredirect" }))
    )

    expect(await probeSandboxUrl("https://x.example.com")).toBe(true)
  })

  it("returns false on the proxy's 5xx placeholder (dev server not up yet)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ status: 503 }))
    )

    expect(await probeSandboxUrl("https://x.example.com")).toBe(false)
  })

  it("returns false when the request throws (sandbox not reachable)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED")
      })
    )

    expect(await probeSandboxUrl("https://x.example.com")).toBe(false)
  })
})
