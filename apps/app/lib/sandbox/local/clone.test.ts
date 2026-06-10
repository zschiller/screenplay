import { execFile } from "node:child_process"
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { promisify } from "node:util"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { acquireRepo, GitError } from "@/lib/sandbox/local/clone"

// The clone manager IS host git — these tests exercise the real `git` binary
// against throwaway repos on disk. `git.test.ts` fakes the sandbox because it
// tests the provider seam; here the seam is git itself, so we drive the
// genuine commands.
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
  root = await mkdtemp(path.join(tmpdir(), "clone-test-"))
  origin = await makeOriginRepo(root)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe("acquireRepo", () => {
  it("clone-url path clones the shared mirror into a managed .git", async () => {
    const managedDir = path.join(root, "managed-clone")

    const repo = await acquireRepo(
      { type: "clone-url", url: `file://${origin}` },
      { managedDir }
    )

    expect(repo.mirrorPath).toBe(path.join(managedDir, "repo"))
    expect(existsSync(path.join(repo.mirrorPath, ".git"))).toBe(true)
    expect(existsSync(path.join(repo.mirrorPath, "README.md"))).toBe(true)
  })

  it("re-acquiring a clone-url reuses the existing managed mirror", async () => {
    const managedDir = path.join(root, "managed-reuse")
    const source = { type: "clone-url" as const, url: `file://${origin}` }

    const first = await acquireRepo(source, { managedDir })
    // Drop a marker; a re-clone would wipe it, a reuse keeps it.
    await writeFile(path.join(first.mirrorPath, "MARKER"), "kept\n")

    const second = await acquireRepo(source, { managedDir })

    expect(second.mirrorPath).toBe(first.mirrorPath)
    expect(existsSync(path.join(second.mirrorPath, "MARKER"))).toBe(true)
  })

  it("local-path path uses the user's existing clone as the mirror", async () => {
    const localClone = path.join(root, "my-checkout")
    await execFileAsync("git", ["clone", `file://${origin}`, localClone])

    const repo = await acquireRepo(
      { type: "local-path", path: localClone },
      { managedDir: path.join(root, "managed-local") }
    )

    // Realpath-normalized: tmpdir on macOS is a symlink, and show-toplevel
    // resolves it — compare against git's own notion of the toplevel.
    const toplevel = await git(localClone, "rev-parse", "--show-toplevel")
    expect(repo.mirrorPath).toBe(toplevel)
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
    expect(repo.mirrorPath).toBe(toplevel)
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

  it("both acquisition paths converge on an equivalent clone manager", async () => {
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

    // Same public surface, same behavior: a clone of `feature` on each.
    const a = await cloned.createClone("sb-a", "feature")
    const b = await local.createClone("sb-b", "feature")
    expect(existsSync(path.join(a.path, "README.md"))).toBe(true)
    expect(existsSync(path.join(b.path, "README.md"))).toBe(true)
    expect(a.ref).toBe("feature")
    expect(b.ref).toBe("feature")
  })
})

describe("createClone / removeClone", () => {
  async function freshManager() {
    const managedDir = path.join(
      root,
      `m-${Math.random().toString(36).slice(2)}`
    )
    return acquireRepo(
      { type: "clone-url", url: `file://${origin}` },
      { managedDir }
    )
  }

  it("checks out an existing branch into a new clone, tracking origin", async () => {
    const repo = await freshManager()

    const clone = await repo.createClone("sb-1", "feature")

    expect(clone.ref).toBe("feature")
    expect(existsSync(path.join(clone.path, "README.md"))).toBe(true)
    expect(await git(clone.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "feature"
    )
    // Tracked, so ordinary push/pull line up against the upstream branch.
    expect(
      await git(clone.path, "rev-parse", "--abbrev-ref", "feature@{upstream}")
    ).toBe("origin/feature")
  })

  it("creates a new branch when the ref doesn't exist yet", async () => {
    const repo = await freshManager()

    const clone = await repo.createClone("sb-1", "brand-new")

    expect(await git(clone.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "brand-new"
    )
  })

  it("creates a missing branch from baseRevision (the no-API path)", async () => {
    const repo = await freshManager()

    const clone = await repo.createClone("sb-1", "new-work", "feature")

    expect(await git(clone.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "new-work"
    )
    // Branched from feature, not from the default HEAD.
    expect(await git(clone.path, "rev-parse", "new-work")).toBe(
      await git(clone.path, "rev-parse", "origin/feature")
    )
  })

  it("N clones on one ref coexist — clones are keyed by Sandbox name, never by ref", async () => {
    const repo = await freshManager()

    const a = await repo.createClone("sb-a", "feature")
    const b = await repo.createClone("sb-b", "feature")

    expect(a.path).not.toBe(b.path)
    expect(await git(a.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "feature"
    )
    expect(await git(b.path, "rev-parse", "--abbrev-ref", "HEAD")).toBe(
      "feature"
    )
    // Independent repositories: committing in one doesn't move the other.
    await writeFile(path.join(a.path, "A.md"), "a\n")
    await git(a.path, "add", ".")
    await git(a.path, "-c", "user.email=t@e.c", "-c", "user.name=T", "commit", "-m", "a work")
    expect(await git(a.path, "rev-parse", "HEAD")).not.toBe(
      await git(b.path, "rev-parse", "HEAD")
    )
  })

  it("clones share the mirror's object store (hardlinked, not re-copied)", async () => {
    const repo = await freshManager()
    const clone = await repo.createClone("sb-1", "feature")

    // Find an object file in the mirror (loose or packed) and check it's
    // hardlinked from the clone: link count > 1 means the object data exists
    // once on disk no matter how many Sandboxes share it.
    const objectsDir = path.join(repo.mirrorPath, ".git", "objects")
    const objectFiles = (
      await readdir(objectsDir, { recursive: true, withFileTypes: true })
    ).filter((entry) => entry.isFile())
    expect(objectFiles.length).toBeGreaterThan(0)
    const linkCounts = await Promise.all(
      objectFiles.map(
        async (entry) =>
          (await stat(path.join(entry.parentPath, entry.name))).nlink
      )
    )
    expect(Math.max(...linkCounts)).toBeGreaterThan(1)
    expect(existsSync(path.join(clone.path, ".git", "objects"))).toBe(true)
  })

  it("re-points origin at the real upstream, never the managed mirror", async () => {
    const repo = await freshManager()
    const clone = await repo.createClone("sb-1", "feature")

    expect(await git(clone.path, "remote", "get-url", "origin")).toBe(
      `file://${origin}`
    )
  })

  it("a local-path clone rides the user clone's own origin", async () => {
    const localClone = path.join(root, "user-checkout")
    await execFileAsync("git", ["clone", `file://${origin}`, localClone])
    const repo = await acquireRepo(
      { type: "local-path", path: localClone },
      { managedDir: path.join(root, "managed-user") }
    )

    const clone = await repo.createClone("sb-1", "feature")

    expect(await git(clone.path, "remote", "get-url", "origin")).toBe(
      `file://${origin}`
    )
  })

  it("re-creating under the same name replaces the clone with a fresh checkout", async () => {
    const repo = await freshManager()
    const first = await repo.createClone("sb-1", "feature")
    await writeFile(path.join(first.path, "uncommitted.txt"), "dirty\n")

    const second = await repo.createClone("sb-1", "feature")

    expect(second.path).toBe(first.path)
    expect(existsSync(path.join(second.path, "uncommitted.txt"))).toBe(false)
  })

  it("removeClone removes only its clone and is idempotent", async () => {
    const repo = await freshManager()
    const a = await repo.createClone("sb-a", "feature")
    const b = await repo.createClone("sb-b", "feature")

    await repo.removeClone("sb-a")

    expect(existsSync(a.path)).toBe(false)
    expect(existsSync(b.path)).toBe(true)
    // Second remove is a no-op, not an error.
    await expect(repo.removeClone("sb-a")).resolves.toBeUndefined()
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
