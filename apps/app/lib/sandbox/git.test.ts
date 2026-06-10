import { beforeEach, describe, expect, it, vi } from "vitest"

import type {
  HibernatingSandbox,
  SandboxCommandResult,
  SandboxInstance,
  SandboxProvider,
} from "@/lib/sandbox/types"
import type { RepoData } from "@/lib/types"

// The git actions resolve the live instance through the provider seam (via the
// runner). A fake provider — scripted, no real VM — stands in for Vercel
// Sandbox so we exercise the real action + runner code path. `vi.hoisted` lets
// the mock factory below close over a mutable holder we rescript per test.
const fake = vi.hoisted(() => {
  let instance: SandboxInstance | null = null
  const provider: SandboxProvider = {
    get: vi.fn(async () => {
      if (!instance) throw new Error("test did not set a fake sandbox instance")
      return instance
    }),
    create: vi.fn(async () => {
      throw new Error("create not used by git actions")
    }),
  }
  return {
    provider,
    setInstance: (i: SandboxInstance) => {
      instance = i
    },
  }
})

// `usesHostGitAuth` is the build-time backend switch (worktree → host-native git
// auth). It's a module-load const in production; a mutable holder lets a test
// flip it to exercise the local path without re-importing the module under test.
const backend = vi.hoisted(() => ({ hostGitAuth: false }))

// Keep the real portable-liveness predicate (it keys on the fake's isRunning),
// mirroring `lib/sandbox/types.ts`; faking it would defeat the branch under test.
vi.mock("@/lib/sandbox", () => ({
  sandboxProvider: fake.provider,
  isSandboxRunning: (s: { isRunning?: () => boolean }) =>
    typeof s?.isRunning === "function" ? s.isRunning() : true,
  get usesHostGitAuth() {
    return backend.hostGitAuth
  },
}))

// `getDiffStats` reads the acting user to attach a git credential env for its
// best-effort fetch. That session lookup needs a request context we don't have
// under plain Node — stub it so the query's parsing is what's under test.
vi.mock("@/lib/auth-helpers", () => ({
  getUserId: vi.fn(async () => null),
  getGitHubTokenForUser: vi.fn(async () => null),
  getGitIdentityForUser: vi.fn(async () => null),
}))

// `renameAgentBranch` also renames the branch on GitHub. That HTTP call is an
// external boundary — fake it so the test pins the action's sandbox + result
// behavior, not the GitHub API. Rescripted per test.
const renameBranch = vi.hoisted(() => vi.fn())
const createBranch = vi.hoisted(() => vi.fn())
vi.mock("@/lib/github-actions", () => ({ renameBranch, createBranch }))

import {
  getGitHubTokenForUser,
  getGitIdentityForUser,
  getUserId,
} from "@/lib/auth-helpers"

import {
  configureAgentGit,
  createAgentBranch,
  getDiffStats,
  renameAgentBranch,
} from "@/lib/sandbox/git"

const repo = {
  repoOwner: "octocat",
  repoName: "hello-world",
  defaultBranch: "main",
} as RepoData

/**
 * Builds a fake hibernating {@link SandboxInstance} (mirroring Vercel) whose
 * `runCommand` is scripted by `respond(cmd, args)`. It carries `isRunning()`
 * derived from `status` so the portable {@link isSandboxRunning} predicate the
 * git actions use resolves correctly. Only the surface the runner touches is
 * implemented; everything else throws so an accidental dependency is loud.
 */
function fakeSandbox(
  respond: (
    cmd: string,
    args: string[]
  ) => { exitCode: number; stdout?: string; stderr?: string },
  status = "running"
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
    name: "fake-sandbox",
    worktreePath: "/vercel/sandbox",
    homeDir: "/home/vercel-sandbox",
    domain: notUsed("domain") as never,
    hostPort: notUsed("hostPort") as never,
    runCommand: runCommand as SandboxInstance["runCommand"],
    writeFiles: notUsed("writeFiles") as never,
    readFileToBuffer: notUsed("readFileToBuffer") as never,
    delete: async () => {},
  }
  ;(sandbox as HibernatingSandbox).isRunning = () => status === "running"
  return sandbox
}

beforeEach(() => {
  vi.clearAllMocks()
  backend.hostGitAuth = false
  // clearAllMocks wipes call history but keeps implementations; restore the
  // null defaults so a test that scripts an identity doesn't leak into the next.
  vi.mocked(getUserId).mockResolvedValue(null)
  vi.mocked(getGitHubTokenForUser).mockResolvedValue(null)
  vi.mocked(getGitIdentityForUser).mockResolvedValue(null)
})

describe("configureAgentGit", () => {
  it("returns success when every git command exits 0", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 })))

    const result = await configureAgentGit("sandbox-a", repo, "feature")

    expect(result).toEqual({ success: true, value: undefined })
  })

  it("installs the per-command git credential helper into the home dir", async () => {
    // The credential helper is git infrastructure (it moved here from the
    // harness install), so configureAgentGit must seed it on every fresh
    // provision regardless of which harnesses were selected.
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push([cmd, ...args].join(" "))
        return { exitCode: 0 }
      })
    )

    await configureAgentGit("sandbox-a", repo, "feature")

    const joined = seen.join("\n")
    expect(joined).toContain(
      "/home/vercel-sandbox/.screenplay/git-credential-helper.sh"
    )
    expect(joined).toContain("git config --global credential.helper")
  })

  it("stamps the triggering user's real identity, never a fabricated address", async () => {
    // The static author net is the *triggering* user's real identity (the
    // per-command broker layers the acting user on top). Crucially it is never
    // the old hardcoded agent@screenplay.dev.
    vi.mocked(getUserId).mockResolvedValue("user-1")
    vi.mocked(getGitIdentityForUser).mockResolvedValue({
      name: "Octo Cat",
      email: "octo@users.noreply.github.com",
    })
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push([cmd, ...args].join(" "))
        return { exitCode: 0 }
      })
    )

    await configureAgentGit("sandbox-a", repo, "feature")

    const joined = seen.join("\n")
    expect(joined).toContain(
      "git config user.email octo@users.noreply.github.com"
    )
    expect(joined).toContain("git config user.name Octo Cat")
    expect(joined).not.toContain("agent@screenplay.dev")
    expect(joined).not.toContain("Screenplay Agent")
  })

  it("sets no identity when the triggering user can't be resolved", async () => {
    // Better no author line than a fabricated one: if the user is unknown we
    // skip the stamp entirely (the per-command broker still attributes commits).
    vi.mocked(getUserId).mockResolvedValue(null)
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push([cmd, ...args].join(" "))
        return { exitCode: 0 }
      })
    )

    await configureAgentGit("sandbox-a", repo, "feature")

    const joined = seen.join("\n")
    expect(joined).not.toContain("git config user.email")
    expect(joined).not.toContain("git config user.name")
    expect(joined).not.toContain("agent@screenplay.dev")
  })

  it("under host-native git auth, skips the remote rewrite and credential helper", async () => {
    // On the local backend git rides the host's own credentials, so the
    // brokered-token plumbing (origin rewrite + SCREENPLAY_GH_TOKEN helper) must
    // not run — rewriting origin would clobber a user's SSH remote.
    backend.hostGitAuth = true
    const seen: string[] = []
    fake.setInstance(
      fakeSandbox((cmd, args) => {
        seen.push([cmd, ...args].join(" "))
        return { exitCode: 0 }
      })
    )

    const result = await configureAgentGit("sandbox-a", repo, "feature")

    expect(result).toEqual({ success: true, value: undefined })
    const joined = seen.join("\n")
    // Branch normalization runs on both backends.
    expect(joined).toContain("git checkout -B feature")
    // Identity / push.default are hosted-only: a plain `git config` writes to
    // the shared `.git/config` (the user's own repo on the local backend), so
    // stamping the agent identity would clobber the user's git identity.
    expect(joined).not.toContain("git config user.name Screenplay Agent")
    expect(joined).not.toContain("agent@screenplay.dev")
    expect(joined).not.toContain("push.default")
    // Hosted-only brokering also does not run.
    expect(joined).not.toContain("set-url")
    expect(joined).not.toContain("git-credential-helper.sh")
    expect(joined).not.toContain("SCREENPLAY_GH_TOKEN")
  })

  it("redacts a GitHub token out of a failed remote-url rewrite", async () => {
    const token = "ghp_0123456789abcdefABCDEF0123456789abcd"
    fake.setInstance(
      fakeSandbox((cmd, args) =>
        args.includes("set-url")
          ? { exitCode: 128, stderr: `fatal: bad url with ${token}` }
          : { exitCode: 0 }
      )
    )

    const result = await configureAgentGit("sandbox-a", repo, "feature")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(token)
    expect(result.error).toContain("[REDACTED]")
  })
})

describe("renameAgentBranch", () => {
  it("renames in the sandbox and reports success even when the remote branch is absent", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 })))
    renameBranch.mockResolvedValue({
      success: false,
      error: "Branch not found",
    })

    const result = await renameAgentBranch(repo, "sandbox-a", "old", "new")

    expect(result).toEqual({ success: true, value: undefined })
    expect(renameBranch).toHaveBeenCalledWith(
      "octocat",
      "hello-world",
      "old",
      "new"
    )
  })

  it("returns a failure result when the in-sandbox rename exits non-zero", async () => {
    fake.setInstance(
      fakeSandbox(() => ({ exitCode: 128, stderr: "branch already exists" }))
    )

    const result = await renameAgentBranch(repo, "sandbox-a", "old", "new")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toContain("branch already exists")
    // The remote rename is never attempted once the local one fails.
    expect(renameBranch).not.toHaveBeenCalled()
  })
})

describe("getDiffStats", () => {
  it("sums additions and deletions across the numstat output", async () => {
    fake.setInstance(
      fakeSandbox((cmd, args) =>
        args.includes("--numstat")
          ? { exitCode: 0, stdout: "3\t1\ta.ts\n10\t2\tb.ts\n" }
          : { exitCode: 0 }
      )
    )

    const result = await getDiffStats("sandbox-a", "main")

    expect(result).toEqual({ additions: 13, deletions: 3 })
  })

  it("counts binary files (shown as '-') as zero", async () => {
    fake.setInstance(
      fakeSandbox((cmd, args) =>
        args.includes("--numstat")
          ? { exitCode: 0, stdout: "-\t-\timage.png\n4\t0\tc.ts\n" }
          : { exitCode: 0 }
      )
    )

    const result = await getDiffStats("sandbox-a", "main")

    expect(result).toEqual({ additions: 4, deletions: 0 })
  })

  it("returns null when the sandbox is not running", async () => {
    fake.setInstance(fakeSandbox(() => ({ exitCode: 0 }), "stopped"))

    const result = await getDiffStats("sandbox-a", "main")

    expect(result).toBeNull()
  })

  it("under host-native git auth, doesn't broker a token for the fetch", async () => {
    backend.hostGitAuth = true
    fake.setInstance(
      fakeSandbox((cmd, args) =>
        args.includes("--numstat")
          ? { exitCode: 0, stdout: "1\t0\ta.ts\n" }
          : { exitCode: 0 }
      )
    )

    const result = await getDiffStats("sandbox-a", "main")

    expect(result).toEqual({ additions: 1, deletions: 0 })
    // Host auth covers the fetch — no per-command token is looked up.
    expect(getGitHubTokenForUser).not.toHaveBeenCalled()
  })
})

describe("createAgentBranch", () => {
  it("maps a successful GitHub branch creation to the result contract", async () => {
    createBranch.mockResolvedValue({ success: true })

    const result = await createAgentBranch(repo, "feature")

    expect(result).toEqual({ success: true, value: undefined })
    expect(createBranch).toHaveBeenCalledWith(
      "octocat",
      "hello-world",
      "feature",
      "main",
      undefined
    )
  })

  it("falls back to the repo default branch when no source branch is given", async () => {
    createBranch.mockResolvedValue({ success: true })

    await createAgentBranch(repo, "feature", undefined, "tok")

    expect(createBranch).toHaveBeenCalledWith(
      "octocat",
      "hello-world",
      "feature",
      "main",
      "tok"
    )
  })

  it("surfaces a redacted failure when GitHub branch creation fails", async () => {
    const token = "ghp_0123456789abcdefABCDEF0123456789abcd"
    createBranch.mockResolvedValue({
      success: false,
      error: `auth failed for ${token}`,
    })

    const result = await createAgentBranch(repo, "feature")

    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).not.toContain(token)
    expect(result.error).toContain("[REDACTED]")
  })
})
