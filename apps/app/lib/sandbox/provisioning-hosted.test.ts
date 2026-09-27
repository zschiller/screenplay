import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  SandboxCommandResult,
  SandboxCreateOptions,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"
import type { RepoData } from "@/lib/types"

// The hosted side of provisioning, where the host does NOT own git auth: the
// branch is created through the GitHub API and the clone is token-authed. A
// scripted fake provider stands in for Vercel Sandbox (every command exits 0);
// `backend.hostGitAuth` flips the one local-vs-hosted switch for the tests that
// pin what changes when it's on.
const fake = vi.hoisted(() => {
  const createCalls: SandboxCreateOptions[] = []
  const commands: string[][] = []
  const getCalls: { name: string; resume?: boolean }[] = []
  let createError: unknown = null
  let deleted = 0
  let getError: unknown = null
  const sandbox = (): SandboxInstance => {
    const ok: SandboxCommandResult = {
      exitCode: 0,
      stdout: async () => "",
      stderr: async () => "",
      logs: () => {
        throw new Error("fake sandbox: logs should not be called")
      },
      kill: async () => {},
    }
    return {
      name: "fake-sandbox",
      worktreePath: "/vercel/sandbox",
      homeDir: "/home/vercel-sandbox",
      domain: (port: number) => `https://fake-${port}.example.com`,
      hostPort: (port: number) => port,
      runCommand: (async (
        first: string | { cmd: string; args?: string[] },
        args?: string[]
      ) => {
        const call =
          typeof first === "string"
            ? [first, ...(args ?? [])]
            : [first.cmd, ...(first.args ?? [])]
        commands.push(call)
        return ok
      }) as SandboxInstance["runCommand"],
      writeFiles: async () => {},
      readFileToBuffer: async () => null,
      delete: async () => {
        deleted++
      },
    }
  }
  const provider: SandboxProvider = {
    get: vi.fn(async (opts: { name: string; resume?: boolean }) => {
      getCalls.push(opts)
      // One-shot, so it models the Sandbox that's *gone* rather than a provider
      // that's down: the recreate teardown's lookup fails, and every `get` after
      // the fresh create still resolves.
      if (getError) {
        const e = getError
        getError = null
        throw e
      }
      return sandbox()
    }),
    create: vi.fn(async (opts: SandboxCreateOptions) => {
      createCalls.push(opts)
      if (createError) throw createError
      return sandbox()
    }),
  }
  return {
    provider,
    createCalls,
    commands,
    getCalls,
    deletes: () => deleted,
    reset: () => {
      createCalls.length = 0
      commands.length = 0
      getCalls.length = 0
      deleted = 0
      createError = null
      getError = null
    },
    setCreateError: (e: unknown) => {
      createError = e
    },
    setGetErrorOnce: (e: unknown) => {
      getError = e
    },
  }
})
const backend = vi.hoisted(() => ({ hostGitAuth: false }))
vi.mock("@/lib/sandbox", () => ({
  sandboxProvider: fake.provider,
  isSandboxRunning: () => true,
  get usesHostGitAuth() {
    return backend.hostGitAuth
  },
}))

vi.mock("@/lib/agent/providers", () => ({ getModelProviders: () => [] }))
const storeEnvVars = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/env-store", () => ({ storeEnvVars }))
vi.mock("@/lib/auth-helpers", () => ({
  getUserId: vi.fn(async () => null),
  getGitHubTokenForUser: vi.fn(async () => null),
  getGitIdentityForUser: vi.fn(async () => null),
}))
const createBranch = vi.hoisted(() =>
  vi.fn(
    async (): Promise<{ success: boolean; error?: string }> => ({
      success: true,
    })
  )
)
vi.mock("@/lib/github-actions", () => ({
  createBranch,
  renameBranch: vi.fn(),
}))
vi.mock("@/lib/sandbox-bridge", () => ({
  PROXY_JS: "proxy",
  BRIDGE_JS: "bridge",
  BRIDGE_VERSION: "v-test",
}))

import { provisionSandbox } from "@/lib/sandbox/provisioning"

const GH_TOKEN = "ghp_0123456789abcdefABCDEF0123456789abcd"

function repo(over: Partial<RepoData> = {}): RepoData {
  return {
    id: "repo-1",
    repoOwner: "o",
    repoName: "r",
    cloneUrl: "https://github.com/o/r.git",
    defaultBranch: "main",
    setupScript: "npm install",
    devScript: "npm run dev",
    devServerPort: 3000,
    envVars: "",
    ...over,
  } as RepoData
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.unstubAllEnvs()
  fake.reset()
  backend.hostGitAuth = false
})

describe("provisionSandbox on the hosted backend", () => {
  it("creates a new branch off the default branch via the GitHub API, then clones it token-authed", async () => {
    const result = await provisionSandbox({
      mode: "new",
      repo: repo(),
      branch: "agent/x",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    })

    expect(result).toEqual({
      success: true,
      value: {
        sandboxName: "fake-sandbox",
        previewDomain: "https://fake-4000.example.com",
      },
    })
    expect(createBranch).toHaveBeenCalledWith(
      "o",
      "r",
      "agent/x",
      "main",
      GH_TOKEN
    )
    expect(fake.createCalls).toHaveLength(1)
    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/o/r.git",
      revision: "agent/x",
      username: "x-access-token",
      password: GH_TOKEN,
    })
    // Dev port, its proxy port, and the BYO-terminal daemon port are forwarded.
    expect(fake.createCalls[0]!.ports).toEqual([3000, 4000, 7681])
  })

  it("duplicates by creating the new branch from the source branch via the API", async () => {
    await provisionSandbox({
      mode: "duplicate",
      repo: repo(),
      branch: "agent/copy",
      sourceBranch: "feature",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    })

    expect(createBranch).toHaveBeenCalledWith(
      "o",
      "r",
      "agent/copy",
      "feature",
      GH_TOKEN
    )
  })

  it("provisions an existing branch without creating one", async () => {
    await provisionSandbox({
      mode: "from-branch",
      repo: repo(),
      branch: "feature",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    })

    expect(createBranch).not.toHaveBeenCalled()
    expect(fake.createCalls[0]!.source).toMatchObject({ revision: "feature" })
  })

  it("fails without creating a sandbox when the API can't create the branch", async () => {
    createBranch.mockResolvedValueOnce({ success: false, error: "nope" })

    const result = await provisionSandbox({
      mode: "new",
      repo: repo(),
      branch: "agent/x",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    })

    expect(result).toEqual({ success: false, error: "nope" })
    expect(fake.createCalls).toHaveLength(0)
  })

  it("clones a public repo without auth when no token is available", async () => {
    await provisionSandbox({
      mode: "from-branch",
      repo: repo(),
      branch: "main",
      sandboxName: "sandbox-a",
    })

    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/o/r.git",
      revision: "main",
    })
  })

  it("persists the Repo's env vars against the new sandbox", async () => {
    await provisionSandbox({
      mode: "from-branch",
      repo: repo({ envVars: "FOO=bar" }),
      branch: "main",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    })

    expect(fake.createCalls[0]!.env).toMatchObject({ FOO: "bar" })
    expect(storeEnvVars).toHaveBeenCalledWith("fake-sandbox", { FOO: "bar" })
  })

  it("returns a redacted failure when sandbox creation throws", async () => {
    fake.setCreateError(new Error(`provider rejected token ${GH_TOKEN}`))

    const result = await provisionSandbox({
      mode: "from-branch",
      repo: repo(),
      branch: "main",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    })

    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(GH_TOKEN)
    expect(result.error).toContain("[REDACTED]")
  })
})

describe("provisionSandbox in recreate mode", () => {
  it("frees the existing Sandbox before provisioning the fresh one", async () => {
    await provisionSandbox({
      mode: "recreate",
      repo: repo(),
      branch: "feature",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    })

    // The old Sandbox is resolved without resuming it (waking a VM only to throw
    // it away is a wasted boot) and deleted, so the fresh one can claim the name.
    expect(fake.getCalls[0]).toEqual({ name: "sandbox-a", resume: false })
    expect(fake.deletes()).toBe(1)
    expect(fake.createCalls).toHaveLength(1)
  })

  it("still provisions when the old Sandbox is already gone", async () => {
    // Freeing the name is best-effort: a fully-expired snapshot leaves nothing to
    // delete, and that's the very case automatic Branch recovery recreates from.
    fake.setGetErrorOnce(new Error("sandbox not found"))

    const result = await provisionSandbox({
      mode: "recreate",
      repo: repo(),
      branch: "feature",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    })

    expect(result.success).toBe(true)
    expect(fake.createCalls).toHaveLength(1)
  })

  it("never creates the branch — it already exists", async () => {
    await provisionSandbox({
      mode: "recreate",
      repo: repo(),
      branch: "feature",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    })

    expect(createBranch).not.toHaveBeenCalled()
    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/o/r.git",
      revision: "feature",
      username: "x-access-token",
      password: GH_TOKEN,
    })
  })

  it("persists the Repo's env vars against the recreated Sandbox", async () => {
    await provisionSandbox({
      mode: "recreate",
      repo: repo({ envVars: "FOO=bar" }),
      branch: "feature",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    })

    expect(fake.createCalls[0]!.env).toMatchObject({ FOO: "bar" })
    expect(storeEnvVars).toHaveBeenCalledWith("fake-sandbox", { FOO: "bar" })
  })

  it("runs the identical step sequence a create runs", async () => {
    // The ticket's invariant: recreate is a *mode* of this module, not a second
    // copy that can drift. `from-branch` is what create does for an existing
    // branch, so given the same inputs the two must issue the same provider
    // create and the same in-Sandbox commands — setup, ripgrep, harnesses, git
    // config, dev launch and all. Compared sorted: the setup / harness / ripgrep
    // installs run concurrently, so their interleaving isn't part of the contract.
    const args = {
      repo: repo({ envVars: "FOO=bar", setupScript: "pnpm install" }),
      branch: "feature",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    } as const

    await provisionSandbox({ mode: "from-branch", ...args })
    const createOptions = fake.createCalls[0]
    const created = [...fake.commands].sort()
    fake.reset()

    await provisionSandbox({ mode: "recreate", ...args })

    expect(fake.createCalls[0]).toEqual(createOptions)
    expect([...fake.commands].sort()).toEqual(created)
    // A guard on the comparison itself: an empty stream would make it vacuous.
    expect(created.flat().join(" ")).toContain("pnpm install")
    expect(created.flat().join(" ")).toContain("ripgrep")
  })
})

describe("provisionSandbox where the host owns git auth", () => {
  it("never calls the GitHub API and creates the branch from the default branch at provision time", async () => {
    backend.hostGitAuth = true

    await provisionSandbox({
      mode: "new",
      repo: repo(),
      branch: "agent/x",
      sandboxName: "sandbox-a",
      ghToken: GH_TOKEN,
    })

    expect(createBranch).not.toHaveBeenCalled()
    // Host auth covers the clone — a passed token is never baked in.
    expect(fake.createCalls[0]!.source).toEqual({
      type: "git",
      url: "https://github.com/o/r.git",
      revision: "agent/x",
      baseRevision: "main",
    })
  })

  it("recreates a local-folder Repo as a worktree of its checkout, never a re-clone", async () => {
    // The drifted pipeline this replaced built its source from the clone URL
    // only — so Recreate on a folder-added Repo (which may have no remote at
    // all, ADR 0013) re-cloned from an empty URL instead of pointing at the
    // user's existing checkout.
    backend.hostGitAuth = true

    await provisionSandbox({
      mode: "recreate",
      repo: repo({ cloneUrl: "", localPath: "/code/r", copyPatterns: ".env*" }),
      branch: "feature",
      sandboxName: "sandbox-a",
    })

    expect(fake.createCalls[0]!.source).toEqual({
      type: "local-git",
      path: "/code/r",
      revision: "feature",
      baseRevision: undefined,
      copyPatterns: [".env*"],
    })
  })

  it("roots a local-folder Repo at its checkout, copying the configured files", async () => {
    backend.hostGitAuth = true

    await provisionSandbox({
      mode: "duplicate",
      repo: repo({ localPath: "/code/r", copyPatterns: ".env*" }),
      branch: "agent/copy",
      sourceBranch: "feature",
      sandboxName: "sandbox-a",
    })

    expect(fake.createCalls[0]!.source).toEqual({
      type: "local-git",
      path: "/code/r",
      revision: "agent/copy",
      baseRevision: "feature",
      copyPatterns: [".env*"],
    })
  })
})
