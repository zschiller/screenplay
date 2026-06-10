import "server-only"

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { redactSensitiveInfo } from "@/lib/agent/redact"

const execFileAsync = promisify(execFile)

/**
 * How a Repo is acquired to a local `.git`. The local app resolves a Repo two
 * ways — point at a clone the user already has, or clone a URL once into an
 * app-managed dir — and the paths diverge **only here**. After acquisition both
 * yield the same {@link WorktreeManager}, so everything downstream
 * (`addWorktree`/`removeWorktree`) is identical. Mirrors the Repo glossary
 * widening: a Repo's "clone URL" is now "clone URL or local path."
 */
export type RepoSource =
  | { type: "local-path"; path: string }
  | { type: "clone-url"; url: string }

export interface AcquireRepoOptions {
  /**
   * The app-managed directory for this Repo. Per-Branch worktrees live under
   * `<managedDir>/worktrees`; a `clone-url` Repo is cloned into
   * `<managedDir>/repo`. A `local-path` Repo keeps its `.git` where it is and
   * only borrows the managed dir for its worktrees, so the user's checkout is
   * never moved or polluted with sibling dirs.
   */
  managedDir: string
}

/** A per-Branch worktree: the git ref it checks out and where it lives on disk. */
export interface Worktree {
  /** The git ref (branch name) this worktree has checked out. */
  readonly ref: string
  /** Absolute path to the worktree's working directory. */
  readonly path: string
}

/**
 * The convergence point both acquisition paths land on. Owns a single local
 * `.git` (the main clone) and hands out one worktree per Branch ref, preserving
 * the **one-worktree-per-branch** invariant: a ref is only ever checked out in
 * one place, so `addWorktree` is idempotent — a second call for a ref already
 * checked out in a *managed* worktree returns that worktree rather than
 * creating a duplicate (which git would reject anyway). A ref checked out in
 * the **main clone itself** is different: that working tree is not ours to hand
 * to an agent (for a `local-path` Repo it is the user's own checkout, live
 * uncommitted edits and all), so `addWorktree` fails loud with
 * {@link BranchCheckedOutInCloneError} instead of aliasing it.
 */
export interface WorktreeManager {
  /** Absolute path to the main clone — the working tree that holds `.git`. */
  readonly repoPath: string
  /**
   * Add (or return the existing managed) worktree for `ref`. If the branch
   * doesn't exist yet it is created from `startPoint` (default: the repo's
   * current HEAD). Idempotent per ref; throws
   * {@link BranchCheckedOutInCloneError} when the main clone has `ref`
   * checked out.
   */
  addWorktree(ref: string, startPoint?: string): Promise<Worktree>
  /**
   * Remove the worktree for `ref` if one exists. A no-op when no worktree is
   * checked out for the ref, and never removes the main clone (git forbids
   * removing the primary worktree), so it is safe to call for any Branch.
   */
  removeWorktree(ref: string): Promise<void>
  /** Every worktree git currently tracks for this repo, including the main clone. */
  listWorktrees(): Promise<Worktree[]>
}

/**
 * Named, user-visible failure for opening a branch the repo's main clone has
 * checked out. On a `local-path` Repo that clone is the **user's own working
 * tree** — handing it to an agent as a Sandbox would mix agent edits into
 * their live, possibly-dirty checkout, so the open is refused instead. (A
 * `clone-url` Repo's managed clone keeps a detached HEAD precisely so this
 * can't happen there.)
 */
export class BranchCheckedOutInCloneError extends Error {
  constructor(
    readonly ref: string,
    clonePath: string
  ) {
    super(
      `The branch "${ref}" is checked out in your local clone (${clonePath}), ` +
        "so it can't be opened as a workspace — the agent would be editing " +
        "that checkout directly. Switch the clone to another branch " +
        `(e.g. \`git switch --detach\`) and retry, or open a different branch.`
    )
    this.name = "BranchCheckedOutInCloneError"
  }
}

/**
 * Thrown when a git invocation exits non-zero. The message is redacted on the
 * way out — a `clone-url` can carry inline basic-auth creds that git echoes
 * back in failures, so we strip them exactly like the sandbox git path does.
 */
export class GitError extends Error {
  constructor(
    readonly args: string[],
    readonly exitCode: number,
    stderr: string
  ) {
    // Redact the whole message — a `clone-url` carries inline basic-auth creds
    // in the args, not just any stderr, so both halves must be scrubbed.
    super(
      redactSensitiveInfo(
        `git ${args.join(" ")} failed (exit ${exitCode}): ${stderr}`
      )
    )
    this.name = "GitError"
  }
}

/**
 * Run `git` on the host. `cwd` scopes the invocation to a repo (the acquisition
 * helpers use `-C`-equivalent cwd). A non-zero exit becomes a redacted
 * {@link GitError}; success returns trimmed stdout.
 */
async function runGit(args: string[], cwd?: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 32 * 1024 * 1024,
    })
    return stdout.trim()
  } catch (err) {
    const e = err as { code?: number; stderr?: string; message?: string }
    throw new GitError(args, e.code ?? 1, e.stderr ?? e.message ?? "")
  }
}

/** True when `dir` is the top of (or inside) a git working tree. */
async function isGitRepo(dir: string): Promise<boolean> {
  try {
    const inside = await runGit(["rev-parse", "--is-inside-work-tree"], dir)
    return inside === "true"
  } catch {
    return false
  }
}

/**
 * Turn a ref into a filesystem-safe directory leaf. Refs nest with `/`
 * (`feature/foo`) and can carry other path-hostile characters; collapse them so
 * the worktree dir is a single flat name under `worktrees/`.
 */
function refToDirName(ref: string): string {
  return ref.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "ref"
}

/**
 * Build a {@link WorktreeManager} over an already-acquired clone. Shared by both
 * acquisition paths — once a local `.git` exists, nothing below cares how it got
 * there.
 */
function makeWorktreeManager(
  repoPath: string,
  worktreesDir: string
): WorktreeManager {
  async function listWorktrees(): Promise<Worktree[]> {
    // Drop entries whose dir was deleted out from under git so a stale record
    // can't shadow a fresh add for the same ref.
    await runGit(["worktree", "prune"], repoPath)
    const porcelain = await runGit(
      ["worktree", "list", "--porcelain"],
      repoPath
    )

    const worktrees: Worktree[] = []
    let currentPath: string | null = null
    for (const line of porcelain.split("\n")) {
      if (line.startsWith("worktree ")) {
        currentPath = line.slice("worktree ".length)
      } else if (line.startsWith("branch ") && currentPath) {
        // `branch refs/heads/<ref>` — a detached worktree omits this line.
        const ref = line.slice("branch ".length).replace(/^refs\/heads\//, "")
        worktrees.push({ ref, path: currentPath })
      } else if (line === "") {
        currentPath = null
      }
    }
    return worktrees
  }

  async function findWorktreeForRef(ref: string): Promise<Worktree | null> {
    const all = await listWorktrees()
    return all.find((w) => w.ref === ref) ?? null
  }

  async function branchExists(ref: string): Promise<boolean> {
    try {
      await runGit(
        ["show-ref", "--verify", "--quiet", `refs/heads/${ref}`],
        repoPath
      )
      return true
    } catch {
      return false
    }
  }

  return {
    repoPath,
    listWorktrees,

    async addWorktree(ref, startPoint): Promise<Worktree> {
      // One-worktree-per-branch: git would reject a second checkout of the same
      // branch, so we never even attempt it. A ref held by a managed worktree is
      // returned as-is (idempotence); a ref held by the main clone is refused —
      // that working tree (the user's own, on a local-path Repo) is not a
      // Sandbox.
      const existing = await findWorktreeForRef(ref)
      if (existing) {
        if (path.resolve(existing.path) === path.resolve(repoPath)) {
          throw new BranchCheckedOutInCloneError(ref, repoPath)
        }
        return existing
      }

      await mkdir(worktreesDir, { recursive: true })
      const worktreePath = path.join(worktreesDir, refToDirName(ref))

      const args = ["worktree", "add"]
      if (await branchExists(ref)) {
        // Existing branch: check it out into the new worktree.
        args.push(worktreePath, ref)
      } else {
        // New branch: create it (from startPoint or current HEAD) in one step.
        args.push("-b", ref, worktreePath)
        if (startPoint) args.push(startPoint)
      }
      await runGit(args, repoPath)

      return { ref, path: worktreePath }
    },

    async removeWorktree(ref): Promise<void> {
      const existing = await findWorktreeForRef(ref)
      if (!existing) return
      // The primary worktree can't be removed (git refuses, and it holds
      // `.git`); leave it for the default branch and treat removal as a no-op.
      if (path.resolve(existing.path) === path.resolve(repoPath)) return
      await runGit(["worktree", "remove", "--force", existing.path], repoPath)
    },
  }
}

/**
 * Acquire a Repo to a local `.git` and return the {@link WorktreeManager} both
 * paths converge on. The only branch in the whole flow:
 *
 * - **`local-path`** — validate the user's existing clone is a git working tree
 *   and root the manager there, riding their remotes and git auth.
 * - **`clone-url`** — `git clone` once into `<managedDir>/repo` (re-acquiring an
 *   already-cloned Repo reuses it), using the host's native git credentials so
 *   private repos work without the app ever holding a token.
 */
export async function acquireRepo(
  source: RepoSource,
  options: AcquireRepoOptions
): Promise<WorktreeManager> {
  const worktreesDir = path.join(options.managedDir, "worktrees")

  if (source.type === "local-path") {
    const resolved = path.resolve(source.path)
    if (!(await isGitRepo(resolved))) {
      throw new Error(`Not a git repository: ${resolved}`)
    }
    // Normalize to the working-tree root so worktree bookkeeping is stable even
    // when the user points at a subdirectory of their clone.
    const repoPath = await runGit(["rev-parse", "--show-toplevel"], resolved)
    return makeWorktreeManager(repoPath, worktreesDir)
  }

  const repoPath = path.join(options.managedDir, "repo")
  // Re-acquiring a Repo we've already cloned reuses the managed clone rather
  // than failing on a non-empty target — clone is the one-time acquisition.
  if (!existsSync(repoPath) || !(await isGitRepo(repoPath))) {
    await mkdir(options.managedDir, { recursive: true })
    await runGit(["clone", source.url, repoPath])
  }
  return makeWorktreeManager(repoPath, worktreesDir)
}
