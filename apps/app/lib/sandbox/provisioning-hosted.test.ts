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
  let createError: unknown = null
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
      runCommand: (async () => ok) as SandboxInstance["runCommand"],
      writeFiles: async () => {},
      readFileToBuffer: async () => null,
      delete: async () => {},
    }
  }
  const provider: SandboxProvider = {
    get: vi.fn(async () => sandbox()),
    create: vi.fn(async (opts: SandboxCreateOptions) => {
      createCalls.push(opts)
      if (createError) throw createError
      return sandbox()
    }),
  }
  return {
    provider,
    createCalls,
    setCreateError: (e: unknown) => {
      createError = e
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
  fake.createCalls.length = 0
  fake.setCreateError(null)
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
