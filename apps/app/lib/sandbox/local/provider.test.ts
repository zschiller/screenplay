import { spawn } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { LocalSandboxProvider } from "@/lib/sandbox/local/provider"
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
let provider: LocalSandboxProvider

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "local-provider-test-"))
  sourceRepo = path.join(tmp, "source")
  root = path.join(tmp, "managed")
  await makeSourceRepo(sourceRepo)
  provider = new LocalSandboxProvider(root)
})

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true })
})

describe("LocalSandboxProvider", () => {
  it("create yields a working SandboxInstance over an independent clone", async () => {
    const sandbox = await provider.create(createOpts("branch-a", sourceRepo))

    expect(sandbox.name).toBe("branch-a")
    expect(sandbox.homeDir).toBe(os.homedir())
    // The clone dir exists and carries the repo's checked-out files.
    const readme = await fs.readFile(
      path.join(sandbox.worktreePath, "README.md"),
      "utf8"
    )
    expect(readme).toBe("hello world\n")
    // It's a real clone of the repo, on the requested branch.
    const branch = await git(sandbox.worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    expect(branch.trim()).toBe("main")
  })

  it("get resolves an existing sandbox into a working instance", async () => {
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

  it("runCommand executes in the clone", async () => {
    const sandbox = await provider.create(createOpts("branch-a", sourceRepo))

    const cat = await sandbox.runCommand("cat", ["README.md"])
    expect(cat.exitCode).toBe(0)
    expect(await cat.stdout()).toBe("hello world\n")

    // cwd is the clone: `pwd` reports it (realpath to dodge /tmp symlinks).
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

    // A clone-relative path and an absolute host path, like the bridge files.
    const absPath = path.join(tmp, "absolute-write.txt")
    await sandbox.writeFiles([
      { path: "nested/note.txt", content: "relative-content" },
      { path: absPath, content: Buffer.from([1, 2, 3, 4]) },
    ])

    const relative = await sandbox.readFileToBuffer({ path: "nested/note.txt" })
    expect(relative?.toString()).toBe("relative-content")
    // Written under the clone, not the cwd.
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

  it("hostPort maps a forwarded port to its allocated host port, stable per Sandbox", async () => {
    const a = await provider.create(createOpts("branch-a", sourceRepo))
    const b = await provider.create(createOpts("branch-b", sourceRepo))

    // Mapped: every Sandbox shares the host network, so the logical port is
    // never assumed bindable. Stable: the same logical port resolves to the
    // same host port across calls and across get().
    const mapped = a.hostPort(3000)
    expect(mapped).not.toBe(3000)
    expect(a.hostPort(3000)).toBe(mapped)
    const resolvedAgain = await provider.get({ name: "branch-a" })
    expect(resolvedAgain.hostPort(3000)).toBe(mapped)

    // Distinct across Sandboxes and across this Sandbox's own ports.
    expect(a.hostPort(3000)).not.toBe(b.hostPort(3000))
    expect(a.hostPort(3000)).not.toBe(a.hostPort(4000))

    // `domain` maps through the same table, so the advertised URL and the
    // bindable port always agree.
    expect(a.domain(3000)).toBe(`http://localhost:${mapped}`)

    // A port the sandbox wasn't created with falls through as identity.
    expect(a.hostPort(9999)).toBe(9999)
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

  it("two Sandboxes on one ref coexist with distinct clones and ports", async () => {
    // The dropped invariant: any number of Branches may sit on one ref, each
    // with its own independent Sandbox. Identity is the Sandbox name, never
    // the ref.
    const a = await provider.create(createOpts("branch-a", sourceRepo))
    const b = await provider.create(createOpts("branch-b", sourceRepo))

    expect(a.worktreePath).not.toBe(b.worktreePath)
    expect(a.domain(3000)).not.toBe(b.domain(3000))
    for (const sandbox of [a, b]) {
      const branch = await git(sandbox.worktreePath, [
        "rev-parse",
        "--abbrev-ref",
        "HEAD",
      ])
      expect(branch.trim()).toBe("main")
    }

    // Deleting one leaves the other fully intact.
    await a.delete()
    expect(
      await fs
        .access(b.worktreePath)
        .then(() => true)
        .catch(() => false)
    ).toBe(true)
    const stillThere = await provider.get({ name: "branch-b" })
    expect(stillThere.worktreePath).toBe(b.worktreePath)
  })

  it("delete removes the clone and reclaims its name", async () => {
    const sandbox = await provider.create(createOpts("branch-a", sourceRepo))
    const clonePath = sandbox.worktreePath
    expect(
      await fs
        .access(clonePath)
        .then(() => true)
        .catch(() => false)
    ).toBe(true)

    await sandbox.delete()

    // The directory is gone…
    expect(
      await fs
        .access(clonePath)
        .then(() => true)
        .catch(() => false)
    ).toBe(false)
    // …and resolving it now fails.
    await expect(provider.get({ name: "branch-a" })).rejects.toThrow()
  })

  it("Recreate maps to remove + re-add", async () => {
    const first = await provider.create(createOpts("branch-a", sourceRepo))
    await first.delete()

    // Re-adding under the same name works (the shared mirror is reused).
    const second = await provider.create(createOpts("branch-a", sourceRepo))
    const readme = await fs.readFile(
      path.join(second.worktreePath, "README.md"),
      "utf8"
    )
    expect(readme).toBe("hello world\n")
  })

  it("re-creating over a live sandbox replaces its clone cleanly", async () => {
    const first = await provider.create(createOpts("branch-a", sourceRepo))
    await fs.writeFile(path.join(first.worktreePath, "dirty.txt"), "dirty\n")
    // No explicit delete — create must clear the prior clone itself.
    const again = await provider.create(createOpts("branch-a", sourceRepo))
    const branch = await git(again.worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    expect(branch.trim()).toBe("main")
    expect(
      await fs
        .access(path.join(again.worktreePath, "dirty.txt"))
        .then(() => true)
        .catch(() => false)
    ).toBe(false)
  })

  it("reuses one managed mirror across Branches of the same repo", async () => {
    await provider.create(createOpts("branch-a", sourceRepo))
    await provider.create(
      createOpts("branch-b", sourceRepo, {
        source: { type: "git", url: sourceRepo, revision: "feature" },
      })
    )
    // Both clones hang off a single managed mirror.
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

  it("provisions a local-path Repo as an independent clone of the user's own clone", async () => {
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

    // The clone is real, on the new branch, with the repo's files.
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

    // It is its own repository — never a worktree of (or the same dir as) the
    // user's clone — so the user's checkout is untouched: still on main, clean,
    // and free of agent-created branches.
    expect(await fs.realpath(sandbox.worktreePath)).not.toBe(
      await fs.realpath(sourceRepo)
    )
    const userBranch = await git(sourceRepo, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    expect(userBranch.trim()).toBe("main")
    const userWorktrees = await git(sourceRepo, ["worktree", "list"])
    expect(userWorktrees).not.toContain(sandbox.worktreePath)
  })

  it("a ref already checked out in the user's clone never blocks a Sandbox on it", async () => {
    // The user has `main` checked out in their own clone; a Branch on `main`
    // still gets its own independent clone (the old worktree backend physically
    // couldn't represent this without sharing the user's working tree).
    const sandbox = await provider.create(
      createOpts("branch-a", sourceRepo, {
        source: { type: "local-git", path: sourceRepo, revision: "main" },
      })
    )
    expect(await fs.realpath(sandbox.worktreePath)).not.toBe(
      await fs.realpath(sourceRepo)
    )
    const branch = await git(sandbox.worktreePath, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    expect(branch.trim()).toBe("main")

    await sandbox.delete()

    // Tearing the Branch down never touches the user's working tree.
    const readme = await fs.readFile(path.join(sourceRepo, "README.md"), "utf8")
    expect(readme).toBe("hello world\n")
    const userBranch = await git(sourceRepo, [
      "rev-parse",
      "--abbrev-ref",
      "HEAD",
    ])
    expect(userBranch.trim()).toBe("main")
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

  it("a legacy worktree-generation sandbox still resolves and deletes", async () => {
    // Reconstruct what the worktree-per-branch generation left on disk: a
    // managed clone with a per-ref worktree, and a meta recording `worktreeDir`
    // (no `cloneDir`). The upgraded provider must keep resolving it and tear it
    // down through `git worktree remove`.
    const managedDir = path.join(root, "managed", "legacyhash")
    const repoDir = path.join(managedDir, "repo")
    await fs.mkdir(managedDir, { recursive: true })
    await git(tmp, ["clone", sourceRepo, repoDir])
    await git(repoDir, ["checkout", "--detach"])
    const wtDir = path.join(managedDir, "worktrees", "feature")
    await fs.mkdir(path.dirname(wtDir), { recursive: true })
    await git(repoDir, ["worktree", "add", wtDir, "feature"])
    const metaDir = path.join(root, "meta")
    await fs.mkdir(metaDir, { recursive: true })
    await fs.writeFile(
      path.join(metaDir, "legacy-a.json"),
      JSON.stringify({
        baseDir: repoDir,
        portMap: { "3000": 51000 },
        worktreeDir: wtDir,
      }),
      "utf8"
    )

    // Resolves through the same get() path, port map intact.
    const sandbox = await provider.get({ name: "legacy-a" })
    expect(sandbox.worktreePath).toBe(wtDir)
    expect(sandbox.hostPort(3000)).toBe(51000)
    const feature = await fs.readFile(path.join(wtDir, "FEATURE.md"), "utf8")
    expect(feature).toBe("feature work\n")

    // Deletes through the legacy worktree path: the dir is gone, git no longer
    // tracks it, and the meta is removed.
    await sandbox.delete()
    expect(
      await fs
        .access(wtDir)
        .then(() => true)
        .catch(() => false)
    ).toBe(false)
    const list = await git(repoDir, ["worktree", "list"])
    expect(list).not.toContain(wtDir)
    await expect(provider.get({ name: "legacy-a" })).rejects.toThrow()
  })
})
