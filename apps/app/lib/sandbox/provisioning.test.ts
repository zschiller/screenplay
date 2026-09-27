import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import path from "node:path"

import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest"

import type { RepoData } from "@/lib/types"

// Provisioning runs against the real local backend: the `SANDBOX_BACKEND`
// switch and the provider's managed root are read at module load, so both are
// set before any import resolves. The temp dir also holds the stand-in login
// shell and a no-op `rg` on PATH (so the best-effort ripgrep install never
// reaches for a real package manager on the test host).
const env = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require("node:fs") as typeof import("node:fs")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeOs = require("node:os") as typeof import("node:os")
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodePath = require("node:path") as typeof import("node:path")
  const tmp = nodeFs.mkdtempSync(
    nodePath.join(nodeOs.tmpdir(), "provisioning-test-")
  )
  const saved = {
    SANDBOX_BACKEND: process.env.SANDBOX_BACKEND,
    SCREENPLAY_WORKTREE_ROOT: process.env.SCREENPLAY_WORKTREE_ROOT,
    SANDBOX_HARNESSES: process.env.SANDBOX_HARNESSES,
  }
  process.env.SANDBOX_BACKEND = "local"
  process.env.SCREENPLAY_WORKTREE_ROOT = nodePath.join(tmp, "managed")
  delete process.env.SANDBOX_HARNESSES
  return { tmp, saved }
})

// The provider registry drags in the kv/db chain; provisioning only folds it
// into the network policy and harness gate vars, so an empty registry will do.
vi.mock("@/lib/agent/providers", () => ({ getModelProviders: () => [] }))
const storeEnvVars = vi.hoisted(() => vi.fn(async () => {}))
vi.mock("@/lib/env-store", () => ({ storeEnvVars }))
vi.mock("@/lib/auth-helpers", () => ({
  getUserId: vi.fn(async () => null),
  getGitHubTokenForUser: vi.fn(async () => null),
  getGitIdentityForUser: vi.fn(async () => null),
}))
// Where the host owns git auth, the GitHub API must never be asked to create a
// branch — the spy lets each test hold provisioning to that.
const createBranch = vi.hoisted(() =>
  vi.fn(async () => ({ success: true as const }))
)
vi.mock("@/lib/github-actions", () => ({
  createBranch,
  renameBranch: vi.fn(),
}))
// The dev launch (portless daemon + supervised dev server + bridge proxy) has
// its own coverage in provision.test.ts; here it would leave host daemons
// running. Stub just the launch and keep every other internal real.
const launchDevAndProxy = vi.hoisted(() =>
  vi.fn(async (sandbox: { domain: (port: number) => string }, port: number) =>
    sandbox.domain(port + 1000)
  )
)
vi.mock("@/lib/sandbox/provision-internals", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/sandbox/provision-internals")
  >()),
  launchDevAndProxy,
}))

import { sandboxProvider } from "@/lib/sandbox"
import { provisionSandbox } from "@/lib/sandbox/provisioning"

function git(cwd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd })
    let stdout = ""
    let stderr = ""
    child.stdout.on("data", (d: Buffer) => (stdout += d.toString()))
    child.stderr.on("data", (d: Buffer) => (stderr += d.toString()))
    child.on("error", reject)
    child.on("close", (code) =>
      code === 0
        ? resolve(stdout.trim())
        : reject(new Error(`git ${args.join(" ")} failed: ${stderr}`))
    )
  })
}

/** A local checkout with `main` and a `feature` branch one commit ahead,
 *  left on `main`. */
async function makeCheckout(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  await git(dir, ["init", "-b", "main"])
  await git(dir, ["config", "user.email", "test@example.com"])
  await git(dir, ["config", "user.name", "Test"])
  await git(dir, ["config", "commit.gpgsign", "false"])
  await fs.writeFile(path.join(dir, "README.md"), "hello\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "initial"])
  await git(dir, ["checkout", "-b", "feature"])
  await fs.writeFile(path.join(dir, "FEATURE.md"), "feature\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "feature"])
  await git(dir, ["checkout", "main"])
}

/** A Repo added from a local folder (PRD #428). */
function localRepo(localPath: string, over: Partial<RepoData> = {}): RepoData {
  return {
    id: "repo-1",
    repoOwner: "o",
    repoName: "r",
    cloneUrl: "",
    localPath,
    defaultBranch: "main",
    setupScript: "true",
    devScript: "true",
    devServerPort: 3000,
    envVars: "",
    ...over,
  } as RepoData
}

let caseDir: string
let checkout: string
let shellLog: string
let sandboxNames: string[]
const savedShell = process.env.SHELL
const savedPath = process.env.PATH

beforeEach(async () => {
  vi.clearAllMocks()
  caseDir = await fs.mkdtemp(path.join(env.tmp, "case-"))
  checkout = path.join(caseDir, "checkout")
  await makeCheckout(checkout)
  sandboxNames = []

  // A stand-in for the user's login shell: records its argv, then runs the
  // command string it was handed (the argument after `-ilc`).
  const bin = path.join(caseDir, "bin")
  await fs.mkdir(bin)
  shellLog = path.join(caseDir, "shell-args")
  const shell = path.join(bin, "login-shell")
  await fs.writeFile(
    shell,
    `#!/bin/sh\nprintf '%s\\n' "$@" > '${shellLog}'\nshift\nexec sh -c "$1"\n`,
    { mode: 0o755 }
  )
  await fs.writeFile(path.join(bin, "rg"), "#!/bin/sh\nexit 0\n", {
    mode: 0o755,
  })
  process.env.SHELL = shell
  process.env.PATH = `${bin}${path.delimiter}${savedPath ?? ""}`
})

afterEach(async () => {
  for (const name of sandboxNames) {
    try {
      const sandbox = await sandboxProvider.get({ name })
      await sandbox.delete()
    } catch {
      // never created (a failed provision) — nothing to clean up
    }
  }
  process.env.SHELL = savedShell
  process.env.PATH = savedPath
})

afterAll(async () => {
  for (const [key, value] of Object.entries(env.saved)) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  await fs.rm(env.tmp, { recursive: true, force: true })
})

function uniqueName(label: string): string {
  const name = `prov-${label}-${Math.random().toString(36).slice(2, 8)}`
  sandboxNames.push(name)
  return name
}

describe("provisionSandbox on the local backend", () => {
  it("provisions a new Branch on a local-folder Repo as a worktree of that checkout", async () => {
    const statuses: string[] = []
    const sandboxName = uniqueName("new")

    const result = await provisionSandbox({
      mode: "new",
      repo: localRepo(checkout),
      branch: "agent/new-thing",
      sandboxName,
      onStatus: (m) => {
        statuses.push(m)
      },
    })

    expect(result).toEqual({
      success: true,
      value: { sandboxName, previewDomain: expect.any(String) },
    })
    const sandbox = await sandboxProvider.get({ name: sandboxName })
    const wt = sandbox.worktreePath
    // A worktree sharing the user's own `.git`, not a fresh clone.
    const commonDir = await git(wt, ["rev-parse", "--git-common-dir"])
    expect(await fs.realpath(path.resolve(wt, commonDir))).toBe(
      await fs.realpath(path.join(checkout, ".git"))
    )
    // On the new branch, created locally off the default branch.
    expect(await git(wt, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "agent/new-thing"
    )
    expect(await git(wt, ["rev-parse", "HEAD"])).toBe(
      await git(checkout, ["rev-parse", "main"])
    )
    // The host owns git, so the GitHub API is never asked for the branch.
    expect(createBranch).not.toHaveBeenCalled()
    expect(statuses).toEqual([
      "Cloning repository…",
      "Installing dependencies…",
      "Starting dev server…",
      "Configuring git…",
    ])
  })

  it("runs the setup script under the user's login shell, in the worktree", async () => {
    const sandboxName = uniqueName("setup")

    const result = await provisionSandbox({
      mode: "new",
      repo: localRepo(checkout, { setupScript: "touch setup-ran && true" }),
      branch: "agent/setup",
      sandboxName,
    })

    expect(result.success).toBe(true)
    const shellArgs = (await fs.readFile(shellLog, "utf8")).trim().split("\n")
    expect(shellArgs).toEqual(["-ilc", "touch setup-ran && true"])
    const sandbox = await sandboxProvider.get({ name: sandboxName })
    await expect(
      fs.access(path.join(sandbox.worktreePath, "setup-ran"))
    ).resolves.toBeUndefined()
  })

  it("duplicates a Branch by forking a new branch from the source branch", async () => {
    const sandboxName = uniqueName("dup")

    const result = await provisionSandbox({
      mode: "duplicate",
      repo: localRepo(checkout),
      branch: "agent/copy",
      sourceBranch: "feature",
      sandboxName,
    })

    expect(result.success).toBe(true)
    const sandbox = await sandboxProvider.get({ name: sandboxName })
    const wt = sandbox.worktreePath
    expect(await git(wt, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe(
      "agent/copy"
    )
    expect(await git(wt, ["rev-parse", "HEAD"])).toBe(
      await git(checkout, ["rev-parse", "feature"])
    )
    expect(createBranch).not.toHaveBeenCalled()
  })

  it("provisions from an existing branch without creating one", async () => {
    const sandboxName = uniqueName("from")

    const result = await provisionSandbox({
      mode: "from-branch",
      repo: localRepo(checkout),
      branch: "feature",
      sandboxName,
    })

    expect(result.success).toBe(true)
    const sandbox = await sandboxProvider.get({ name: sandboxName })
    await expect(
      fs.readFile(path.join(sandbox.worktreePath, "FEATURE.md"), "utf8")
    ).resolves.toBe("feature\n")
  })

  it("fails on a failing setup script without launching the dev server", async () => {
    const result = await provisionSandbox({
      mode: "new",
      repo: localRepo(checkout, { setupScript: "exit 3" }),
      branch: "agent/broken",
      sandboxName: uniqueName("fail"),
    })

    expect(result.success).toBe(false)
    expect(launchDevAndProxy).not.toHaveBeenCalled()
  })

  it("recreates onto the existing branch as a worktree of the checkout, never a re-clone", async () => {
    const sandboxName = uniqueName("recreate")
    const repo = localRepo(checkout)
    // A live Sandbox on `feature`, with work in its worktree that a recreate is
    // expected to discard.
    expect(
      (
        await provisionSandbox({
          mode: "from-branch",
          repo,
          branch: "feature",
          sandboxName,
        })
      ).success
    ).toBe(true)
    const before = await sandboxProvider.get({ name: sandboxName })
    await fs.writeFile(path.join(before.worktreePath, "scratch.txt"), "wip\n")

    const statuses: string[] = []
    const result = await provisionSandbox({
      mode: "recreate",
      repo,
      branch: "feature",
      sandboxName,
      onStatus: (m) => {
        statuses.push(m)
      },
    })

    expect(result).toEqual({
      success: true,
      value: { sandboxName, previewDomain: expect.any(String) },
    })
    const sandbox = await sandboxProvider.get({ name: sandboxName })
    const wt = sandbox.worktreePath
    // Still a worktree sharing the user's own `.git`. The Repo has no clone URL
    // at all (a folder-added Repo may have no remote — ADR 0013), so a recreate
    // that re-cloned instead would have failed outright.
    const commonDir = await git(wt, ["rev-parse", "--git-common-dir"])
    expect(await fs.realpath(path.resolve(wt, commonDir))).toBe(
      await fs.realpath(path.join(checkout, ".git"))
    )
    // On the same branch, at the same commit — the branch already existed, so
    // it is never re-created (least of all through the GitHub API).
    expect(await git(wt, ["rev-parse", "--abbrev-ref", "HEAD"])).toBe("feature")
    expect(await git(wt, ["rev-parse", "HEAD"])).toBe(
      await git(checkout, ["rev-parse", "feature"])
    )
    expect(createBranch).not.toHaveBeenCalled()
    // Destructive, as advertised: the old checkout's uncommitted work is gone.
    await expect(fs.access(path.join(wt, "scratch.txt"))).rejects.toThrow()
    // And it reports the same steps a create does.
    expect(statuses).toEqual([
      "Cloning repository…",
      "Installing dependencies…",
      "Starting dev server…",
      "Configuring git…",
    ])
  })

  it("recreates through the same setup and env-var steps a create runs", async () => {
    const sandboxName = uniqueName("recreate-setup")
    const repo = localRepo(checkout, {
      setupScript: "touch setup-ran && true",
      envVars: "FOO=bar",
    })
    await provisionSandbox({
      mode: "new",
      repo,
      branch: "agent/recreate",
      sandboxName,
    })
    vi.clearAllMocks()
    await fs.rm(shellLog)

    const result = await provisionSandbox({
      mode: "recreate",
      repo,
      branch: "agent/recreate",
      sandboxName,
    })

    expect(result.success).toBe(true)
    // Setup ran under the user's login shell, in the fresh worktree — the drifted
    // pipeline this replaced bare-spawned a whitespace-split argv, which resolves
    // `pnpm` against the sidecar's PATH rather than the user's.
    const shellArgs = (await fs.readFile(shellLog, "utf8")).trim().split("\n")
    expect(shellArgs).toEqual(["-ilc", "touch setup-ran && true"])
    const sandbox = await sandboxProvider.get({ name: sandboxName })
    await expect(
      fs.access(path.join(sandbox.worktreePath, "setup-ran"))
    ).resolves.toBeUndefined()
    // …and the Repo's env vars are persisted against the recreated Sandbox, which
    // the drifted pipeline skipped entirely.
    expect(storeEnvVars).toHaveBeenCalledWith(sandboxName, { FOO: "bar" })
  })

  it("rejects a duplicate with no source branch before touching anything", async () => {
    const onStatus = vi.fn()

    const result = await provisionSandbox({
      mode: "duplicate",
      repo: localRepo(checkout),
      branch: "agent/copy",
      sandboxName: uniqueName("nosrc"),
      onStatus,
    })

    expect(result).toEqual({
      success: false,
      error: "Source branch not specified",
    })
    expect(onStatus).not.toHaveBeenCalled()
  })
})
