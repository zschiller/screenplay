import { execFile } from "node:child_process"
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import {
  acquireRepo,
  BranchCheckedOutInCloneError,
  GitError,
} from "@/lib/sandbox/local/worktree"

// The worktree manager IS host git — these tests exercise the real `git`
// binary against throwaway repos on disk, the way the PRD calls for ("against
// temp repos"). `git.test.ts` fakes the sandbox because it tests the provider
// seam; here the seam is git itself, so we drive the genuine commands.
const execFileAsync = promisify(execFile)

async function git(cwd: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd })
  return stdout.trim()
}

/** A bare repo with one commit on `main` — stands in for the user's "remote". */
async function makeOriginRepo(root: string): Promise<string> {
  const work = path.join(root, "origin-work")
  await execFileAsync("git", ["init", "-b", "main", work])
  await git(work, "config", "user.email", "test@example.com")
  await git(work, "config", "user.name", "Test")
  // The host may have commit signing configured globally; throwaway test repos
  // must commit without it (no signing server in CI).
  await git(work, "config", "commit.gpgsign", "false")
  await git(work, "config", "tag.gpgsign", "false")
  await writeFile(path.join(work, "README.md"), "# hello\n")
  await git(work, "add", ".")
  await git(work, "commit", "-m", "initial")
  // A second branch so we can check out an existing (non-default) ref.
  await git(work, "branch", "feature")

  const bare = path.join(root, "origin.git")
  await execFileAsync("git", ["clone", "--bare", work, bare])
  return bare
}

let root: string
let origin: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "worktree-test-"))
  origin = await makeOriginRepo(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("acquireRepo", () => {
  it("clone-url path clones into a managed .git", async () => {
    const managedDir = path.join(root, "managed-clone")

    const repo = await acquireRepo(
      { type: "clone-url", url: `file://${origin}` },
      { managedDir }
    )

    // Realpath-normalized, like the local-path cases below: the managed clone
    // lives at `<managedDir>/repo`, but git (and so the manager) reports it
    // through `realpath`, which resolves the macOS tmpdir symlink (`/var` →
    // `/private/var`). Compare against the resolved path, not the constructed one.
    expect(repo.repoPath).toBe(await realpath(path.join(managedDir, "repo")))
    expect(existsSync(path.join(repo.repoPath, ".git"))).toBe(true)
    expect(existsSync(path.join(repo.repoPath, "README.md"))).toBe(true)
  })

  it("re-acquiring a clone-url reuses the existing managed clone", async () => {
    const managedDir = path.join(root, "managed-reuse")
    const source = { type: "clone-url" as const, url: `file://${origin}` }

    const first = await acquireRepo(source, { managedDir })
    // Drop a marker; a re-clone would wipe it, a reuse keeps it.
    await writeFile(path.join(first.repoPath, "MARKER"), "kept\n")

    const second = await acquireRepo(source, { managedDir })

    expect(second.repoPath).toBe(first.repoPath)
    expect(existsSync(path.join(second.repoPath, "MARKER"))).toBe(true)
  })

  it("local-path path roots the manager at an existing clone", async () => {
    const localClone = path.join(root, "my-checkout")
    await execFileAsync("git", ["clone", `file://${origin}`, localClone])

    const repo = await acquireRepo(
      { type: "local-path", path: localClone },
      { managedDir: path.join(root, "managed-local") }
    )

    // Realpath-normalized: tmpdir on macOS is a symlink, and show-toplevel
    // resolves it — compare against git's own notion of the toplevel.
    const toplevel = await git(localClone, "rev-parse", "--show-toplevel")
    expect(repo.repoPath).toBe(toplevel)
  })

  it("local-path normalizes a subdirectory to the working-tree root", async () => {
    const localClone = path.join(root, "subdir-checkout")
    await execFileAsync("git", ["clone", `file://${origin}`, localClone])
    const sub = path.join(localClone, "nested")
    await execFileAsync("mkdir", ["-p", sub])

    const repo = await acquireRepo(
      { type: "local-path", path: sub },
      { managedDir: path.join(root, "managed-sub") }
    )

    const toplevel = await git(localClone, "rev-parse", "--show-toplevel")
    expect(repo.repoPath).toBe(toplevel)
  })

  it("local-path rejects a directory that isn't a git repo", async () => {
    const notARepo = path.join(root, "plain-dir")
    await execFileAsync("mkdir", ["-p", notARepo])

    await expect(
      acquireRepo(
        { type: "local-path", path: notARepo },
        { managedDir: path.join(root, "managed-bad") }
      )
    ).rejects.toThrow(/Not a git repository/)
  })

  it("both acquisition paths converge on an equivalent worktree manager", async () => {
    const cloned = await acquireRepo(
      { type: "clone-url", url: `file://${origin}` },
      { managedDir: path.join(root, "converge-clone") }
    )
    const localCheckout = path.join(root, "converge-checkout")
    await execFileAsync("git", ["clone", `file://${origin}`, localCheckout])
    const local = await acquireRepo(
      { type: "local-path", path: localCheckout },
      { managedDir: path.join(root, "converge-local") }
    )

    // Same public surface, same behavior: add a worktree for `feature` on each.
    const a = await cloned.addWorktree("feature")
    const b = await local.addWorktree("feature")
    expect(existsSync(path.join(a.path, "README.md"))).toBe(true)
    expect(existsSync(path.join(b.path, "README.md"))).toBe(true)
    expect(a.ref).toBe("feature")
    expect(b.ref).toBe("feature")
  })
})

describe("addWorktree / removeWorktree", () => {
  async function freshClone() {
    const managedDir = path.join(
      root,
      `m-${Math.random().toString(36).slice(2)}`
    )
    return acquireRepo(
      { type: "clone-url", url: `file://${origin}` },
      { managedDir }
    )
  }

  it("checks out an existing branch into a new worktree", async () => {
    const repo = await freshClone()

    const wt = await repo.addWorktree("feature")

    expect(wt.ref).toBe("feature")
    expect(existsSync(path.join(wt.path, "README.md"))).toBe(true)
    expect(await git(wt.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "feature"
    )
  })

  it("creates a new branch when the ref doesn't exist yet", async () => {
    const repo = await freshClone()

    const wt = await repo.addWorktree("brand-new")

    expect(await git(wt.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "brand-new"
    )
    // Branch now exists in the repo's ref store.
    expect(
      await git(repo.repoPath, "show-ref", "--verify", "refs/heads/brand-new")
    ).toContain("refs/heads/brand-new")
  })

  it("is idempotent per ref — a second add returns the same worktree", async () => {
    const repo = await freshClone()

    const first = await repo.addWorktree("feature")
    const second = await repo.addWorktree("feature")

    expect(second.path).toBe(first.path)
  })

  it("refuses a ref the main clone has checked out", async () => {
    const repo = await freshClone()

    // The fresh clone sits on `main`; a worktree for it would hand that
    // working tree (the user's own, on a local-path Repo) to an agent.
    await expect(repo.addWorktree("main")).rejects.toThrow(
      BranchCheckedOutInCloneError
    )
  })

  it("upholds one-worktree-per-branch across distinct refs", async () => {
    const repo = await freshClone()

    const a = await repo.addWorktree("feature")
    const b = await repo.addWorktree("another")

    expect(a.path).not.toBe(b.path)
    // Each ref appears exactly once across all tracked worktrees.
    const all = await repo.listWorktrees()
    const refs = all.map((w) => w.ref)
    expect(refs.filter((r) => r === "feature")).toHaveLength(1)
    expect(refs.filter((r) => r === "another")).toHaveLength(1)
  })

  it("removeWorktree removes the checkout and is idempotent", async () => {
    const repo = await freshClone()
    const wt = await repo.addWorktree("feature")
    expect(existsSync(wt.path)).toBe(true)

    await repo.removeWorktree("feature")
    expect(existsSync(wt.path)).toBe(false)

    // Second remove is a no-op, not an error.
    await expect(repo.removeWorktree("feature")).resolves.toBeUndefined()
  })

  it("removeWorktree is a no-op for a ref with no worktree", async () => {
    const repo = await freshClone()

    await expect(repo.removeWorktree("never-added")).resolves.toBeUndefined()
  })

  it("removeWorktree force-removes a dirty worktree (Recreate path)", async () => {
    const repo = await freshClone()
    const wt = await repo.addWorktree("feature")
    await writeFile(path.join(wt.path, "uncommitted.txt"), "dirty\n")

    await repo.removeWorktree("feature")

    expect(existsSync(wt.path)).toBe(false)
  })
})

describe("GitError", () => {
  it("redacts inline basic-auth creds from a failed clone", async () => {
    // A bogus URL with embedded creds that git will fail to reach. The message
    // must not echo the password back.
    let caught: unknown
    try {
      await acquireRepo(
        {
          type: "clone-url",
          url: "https://user:supersecret@127.0.0.1:1/nope.git",
        },
        { managedDir: path.join(root, "managed-auth") }
      )
    } catch (err) {
      caught = err
    }

    expect(caught).toBeInstanceOf(GitError)
    expect((caught as Error).message).not.toContain("supersecret")
    expect((caught as Error).message).toContain("[REDACTED]")
  })
})
