import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { WorktreeSandboxProvider } from "@/lib/sandbox/worktree"
import type { SandboxCreateOptions } from "@/lib/sandbox/types"

// Run git in a directory, failing loudly so a botched fixture is obvious.
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
        ? resolve(stdout)
        : reject(new Error(`git ${args.join(" ")} failed: ${stderr}`))
    )
  })
}

/** A throwaway git repo on disk with one commit on `main` and a `feature`
 *  branch one commit ahead (left checked out on `main`). */
async function makeSourceRepo(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true })
  await git(dir, ["init", "-b", "main"])
  await git(dir, ["config", "user.email", "test@example.com"])
  await git(dir, ["config", "user.name", "Test"])
  // The CI/sandbox env can force commit signing globally; keep the fixture
  // self-contained and offline by turning it off for this repo.
  await git(dir, ["config", "commit.gpgsign", "false"])
  await git(dir, ["config", "tag.gpgsign", "false"])
  await fs.writeFile(path.join(dir, "README.md"), "hello world\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "initial commit"])
  await git(dir, ["checkout", "-b", "feature"])
  await fs.writeFile(path.join(dir, "FEATURE.md"), "feature work\n")
  await git(dir, ["add", "."])
  await git(dir, ["commit", "-m", "feature commit"])
  await git(dir, ["checkout", "main"])
}

function createOpts(
  name: string,
  sourceUrl: string,
  overrides: Partial<SandboxCreateOptions> = {}
): SandboxCreateOptions {
  return {
    name,
    source: { type: "git", url: sourceUrl, revision: "main" },
    ports: [3000, 4000, 7681],
    timeout: 0,
    ...overrides,
  }
}

let tmp: string
let sourceRepo: string
let root: string
let provider: WorktreeSandboxProvider

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "worktree-test-"))
  sourceRepo = path.join(tmp, "source")
  root = path.join(tmp, "managed")
  await makeSourceRepo(sourceRepo)
  provider = new WorktreeSandboxProvider(root)
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("WorktreeSandboxProvider", () => {
  it("create yields a working SandboxInstance over a worktree", async () => {
    const sandbox = await provider.create(createOpts("branch-a", sourceRepo))

    expect(sandbox.name).toBe("branch-a")
    expect(sandbox.homeDir).toBe(os.homedir())
    // The worktree dir exists and carries the repo's checked-out files.
    const readme = await fs.readFile(
      path.join(sandbox.worktreePath, "README.md"),
      "utf8"
    )
    expect(readme).toBe("hello world\n")
    // It's a real worktree of the repo, on the requested branch.
    const branch = await git(sandbox.worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    expect(branch.trim()).toBe("main")
  })

  it("get resolves an existing worktree into a working instance", async () => {
    await provider.create(createOpts("branch-a", sourceRepo))
    const sandbox = await provider.get({ name: "branch-a" })

    const readme = await fs.readFile(
      path.join(sandbox.worktreePath, "README.md"),
      "utf8"
    )
    expect(readme).toBe("hello world\n")
  })

  it("get throws for an unknown sandbox", async () => {
    await expect(provider.get({ name: "missing" })).rejects.toThrow()
  })

  it("runCommand executes in the worktree", async () => {
    const sandbox = await provider.create(createOpts("branch-a", sourceRepo))

    const cat = await sandbox.runCommand("cat", ["README.md"])
    expect(cat.exitCode).toBe(0)
    expect(await cat.stdout()).toBe("hello world\n")

    // cwd is the worktree: `pwd` reports it (realpath to dodge /tmp symlinks).
    const pwd = await sandbox.runCommand({ cmd: "pwd", args: [] })
    const real = await fs.realpath(sandbox.worktreePath)
    expect((await pwd.stdout()).trim()).toBe(real)
  })

  it("surfaces a non-zero exit code with stderr", async () => {
    const sandbox = await provider.create(createOpts("branch-a", sourceRepo))

    const result = await sandbox.runCommand("sh", [
      "-c",
      "echo boom >&2; exit 3",
    ])
    expect(result.exitCode).toBe(3)
    expect(await result.stderr()).toBe("boom\n")
  })

  it("writeFiles / readFileToBuffer round-trip on the host fs", async () => {
    const sandbox = await provider.create(createOpts("branch-a", sourceRepo))

    // A worktree-relative path and an absolute host path, like the bridge files.
    const absPath = path.join(tmp, "absolute-write.txt")
    await sandbox.writeFiles([
      { path: "nested/note.txt", content: "relative-content" },
      { path: absPath, content: Buffer.from([1, 2, 3, 4]) },
    ])

    const relative = await sandbox.readFileToBuffer({ path: "nested/note.txt" })
    expect(relative?.toString()).toBe("relative-content")
    // Written under the worktree, not the cwd.
    const onDisk = await fs.readFile(
      path.join(sandbox.worktreePath, "nested/note.txt"),
      "utf8"
    )
    expect(onDisk).toBe("relative-content")

    const absolute = await sandbox.readFileToBuffer({ path: absPath })
    expect(absolute).toEqual(Buffer.from([1, 2, 3, 4]))
  })

  it("readFileToBuffer returns null for a missing file", async () => {
    const sandbox = await provider.create(createOpts("branch-a", sourceRepo))
    expect(
      await sandbox.readFileToBuffer({ path: "does-not-exist" })
    ).toBeNull()
  })

  it("domain returns an allocated localhost URL, distinct per Branch", async () => {
    const a = await provider.create(createOpts("branch-a", sourceRepo))
    const b = await provider.create(createOpts("branch-b", sourceRepo))

    expect(a.domain(3000)).toMatch(/^http:\/\/localhost:\d+$/)
    // Each forwarded port maps to its own host port…
    expect(a.domain(3000)).not.toBe(a.domain(4000))
    // …and two Branches never collide on the same one.
    expect(a.domain(3000)).not.toBe(b.domain(3000))
  })

  it("delete removes the worktree and reclaims its name", async () => {
    const sandbox = await provider.create(createOpts("branch-a", sourceRepo))
    const wtPath = sandbox.worktreePath
    expect(
      await fs
        .access(wtPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(true)

    await sandbox.delete()

    // The directory is gone…
    expect(
      await fs
        .access(wtPath)
        .then(() => true)
        .catch(() => false)
    ).toBe(false)
    // …and git no longer tracks it as a worktree.
    const baseDir = path.join(
      root,
      "managed",
      (await fs.readdir(path.join(root, "managed")))[0]!,
      "repo"
    )
    const list = await git(baseDir, ["worktree", "list"])
    expect(list).not.toContain(wtPath)
    // …and resolving it now fails.
    await expect(provider.get({ name: "branch-a" })).rejects.toThrow()
  })

  it("Recreate maps to remove + re-add", async () => {
    const first = await provider.create(createOpts("branch-a", sourceRepo))
    await first.delete()

    // Re-adding under the same name works (the base clone is reused).
    const second = await provider.create(createOpts("branch-a", sourceRepo))
    const readme = await fs.readFile(
      path.join(second.worktreePath, "README.md"),
      "utf8"
    )
    expect(readme).toBe("hello world\n")
  })

  it("re-adding over a live worktree replaces it cleanly", async () => {
    await provider.create(createOpts("branch-a", sourceRepo))
    // No explicit delete — create must clear the prior worktree itself.
    const again = await provider.create(createOpts("branch-a", sourceRepo))
    const branch = await git(again.worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    expect(branch.trim()).toBe("main")
  })

  it("reuses one managed clone across Branches of the same repo", async () => {
    await provider.create(createOpts("branch-a", sourceRepo))
    await provider.create(
      createOpts("branch-b", sourceRepo, {
        source: { type: "git", url: sourceRepo, revision: "feature" },
      })
    )
    // Both worktrees share a single managed clone.
    const managed = await fs.readdir(path.join(root, "managed"))
    expect(managed).toHaveLength(1)
  })

  it("creates a missing branch locally from baseRevision (the no-API path)", async () => {
    // `new-work` exists nowhere; the provider must create it from `feature`
    // rather than failing or branching off the clone's HEAD (`main`).
    const sandbox = await provider.create(
      createOpts("branch-a", sourceRepo, {
        source: {
          type: "git",
          url: sourceRepo,
          revision: "new-work",
          baseRevision: "feature",
        },
      })
    )

    const branch = await git(sandbox.worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    expect(branch.trim()).toBe("new-work")
    // Branched from feature: its commit is present.
    const feature = await fs.readFile(
      path.join(sandbox.worktreePath, "FEATURE.md"),
      "utf8"
    )
    expect(feature).toBe("feature work\n")
  })

  it("checks out a remote branch that only exists on origin", async () => {
    const sandbox = await provider.create(
      createOpts("branch-a", sourceRepo, {
        source: { type: "git", url: sourceRepo, revision: "feature" },
      })
    )
    const branch = await git(sandbox.worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    expect(branch.trim()).toBe("feature")
  })

  it("provisions a local-path Repo as a worktree of the user's own clone", async () => {
    const sandbox = await provider.create(
      createOpts("branch-a", sourceRepo, {
        source: {
          type: "local-git",
          path: sourceRepo,
          revision: "agent-work",
          baseRevision: "main",
        },
      })
    )

    // The worktree is real, on the new branch, with the repo's files.
    const branch = await git(sandbox.worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    expect(branch.trim()).toBe("agent-work")
    const readme = await fs.readFile(
      path.join(sandbox.worktreePath, "README.md"),
      "utf8"
    )
    expect(readme).toBe("hello world\n")

    // It hangs off the user's clone — same object store, no managed clone.
    const list = await git(sourceRepo, ["worktree", "list"])
    expect(list).toContain(await fs.realpath(sandbox.worktreePath))
    expect(
      await fs
        .access(path.join(root, "managed"))
        .then(() => fs.readdir(path.join(root, "managed")))
        .catch(() => [])
    ).not.toContain("repo")

    // The user's checkout itself is untouched: still on main, still clean.
    const userBranch = await git(sourceRepo, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    expect(userBranch.trim()).toBe("main")
  })

  it("delete on a local-path Repo removes the worktree but never the clone", async () => {
    const sandbox = await provider.create(
      createOpts("branch-a", sourceRepo, {
        source: {
          type: "local-git",
          path: sourceRepo,
          revision: "agent-work",
          baseRevision: "main",
        },
      })
    )
    await sandbox.delete()

    expect(
      await fs
        .access(sandbox.worktreePath)
        .then(() => true)
        .catch(() => false)
    ).toBe(false)
    // The user's clone survives, working tree intact.
    const readme = await fs.readFile(path.join(sourceRepo, "README.md"), "utf8")
    expect(readme).toBe("hello world\n")
  })

  it("a ref already checked out in the user's clone resolves to that clone — and delete leaves it alone", async () => {
    // The user has `main` checked out in their own clone; a Branch on `main`
    // converges on that checkout (one-worktree-per-branch), and tearing the
    // Branch down must not touch the user's working tree.
    const sandbox = await provider.create(
      createOpts("branch-a", sourceRepo, {
        source: { type: "local-git", path: sourceRepo, revision: "main" },
      })
    )
    expect(await fs.realpath(sandbox.worktreePath)).toBe(
      await fs.realpath(sourceRepo)
    )

    await sandbox.delete()

    const readme = await fs.readFile(path.join(sourceRepo, "README.md"), "utf8")
    expect(readme).toBe("hello world\n")
    const branch = await git(sourceRepo, ["rev-parse", "--abbrev-ref", "HEAD"])
    expect(branch.trim()).toBe("main")
  })

  it("rejects a local-path source that isn't a git repository", async () => {
    const notARepo = path.join(tmp, "plain-folder")
    await fs.mkdir(notARepo, { recursive: true })
    await expect(
      provider.create(
        createOpts("branch-a", sourceRepo, {
          source: { type: "local-git", path: notARepo, revision: "main" },
        })
      )
    ).rejects.toThrow(/Not a git repository/)
  })

  it("rejects a snapshot source (this backend cannot hibernate)", async () => {
    await expect(
      provider.create(
        createOpts("branch-a", sourceRepo, {
          source: { type: "snapshot", snapshotId: "snap-1" },
        })
      )
    ).rejects.toThrow(/snapshot/)
  })

  it("runs a detached command without waiting for it to exit", async () => {
    const sandbox = await provider.create(createOpts("branch-a", sourceRepo))
    const marker = path.join(sandbox.worktreePath, "detached-marker")

    const result = await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", `sleep 0.2; echo done > ${marker}`],
      detached: true,
    })
    // Resolves immediately with a success code, before the sleep finishes.
    expect(result.exitCode).toBe(0)
    expect(
      await fs
        .access(marker)
        .then(() => true)
        .catch(() => false)
    ).toBe(false)

    // The process keeps running and eventually writes the marker.
    await new Promise((r) => setTimeout(r, 600))
    expect(await fs.readFile(marker, "utf8")).toBe("done\n")
  })
})
