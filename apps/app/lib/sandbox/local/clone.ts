import "server-only"

import { execFile } from "node:child_process"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import { redactSensitiveInfo } from "@/lib/agent/redact"

const execFileAsync = promisify(execFile)

/**
 * How a Repo is acquired to a local `.git`. The local app resolves a Repo two
 * ways — point at a clone the user already has, or clone a URL once into an
 * app-managed dir — and the paths diverge **only here**. After acquisition both
 * yield the same {@link CloneManager}, so everything downstream
 * (`createClone`/`removeClone`) is identical. Mirrors the Repo glossary
 * widening: a Repo's "clone URL" is now "clone URL or local path."
 */
export type RepoSource =
  | { type: "local-path"; path: string }
  | { type: "clone-url"; url: string }

export interface AcquireRepoOptions {
  /**
   * The app-managed directory for this Repo. Per-Sandbox clones live under
   * `<managedDir>/clones`; a `clone-url` Repo's shared mirror is cloned into
   * `<managedDir>/repo`. A `local-path` Repo keeps its `.git` where it is and
   * only borrows the managed dir for its clones, so the user's checkout is
   * never moved or polluted with sibling dirs.
   */
  managedDir: string
}

/** A per-Sandbox clone: the git ref it checked out and where it lives on disk. */
export interface Clone {
  /** The git ref (branch name) this clone has checked out. */
  readonly ref: string
  /** Absolute path to the clone's working directory. */
  readonly path: string
}

/**
 * The convergence point both acquisition paths land on. Owns the shared
 * per-source **mirror** (one local `.git` per clone URL / local path) and hands
 * out one independent clone per Sandbox, hardlinked against the mirror's object
 * store so N open Branches cost ≈ N working trees, not N repo downloads.
 *
 * Clones are keyed by **Sandbox name, never by ref**: any number of Sandboxes
 * may sit on one ref (each in its own clone), which is exactly the
 * independent-clone model the hosted backend always had. The old
 * one-worktree-per-branch constraint was a git-worktree artifact, not a domain
 * rule, and does not exist here by construction. Concurrent Sandboxes on one
 * ref coordinate through ordinary git push/pull semantics (non-fast-forward
 * pushes are rejected; agents don't force-push).
 */
export interface CloneManager {
  /** Absolute path to the shared per-source mirror (the local `.git` both acquisition paths converge on). */
  readonly mirrorPath: string
  /** Where the named Sandbox's clone lives (whether or not it exists yet). */
  clonePathFor(name: string): string
  /**
   * Create (or re-create — an existing clone under `name` is replaced) the
   * Sandbox's independent clone with `ref` checked out. If the branch doesn't
   * exist anywhere yet it is created from `baseRevision` (default: the clone's
   * HEAD). Keyed by Sandbox name: a second Sandbox on the same ref gets its own
   * second clone.
   */
  createClone(name: string, ref: string, baseRevision?: string): Promise<Clone>
  /**
   * Remove the named Sandbox's clone. The clone is an independent repository —
   * deleting its directory releases everything it held — so this is a plain
   * recursive remove and a no-op when the clone is already gone.
   */
  removeClone(name: string): Promise<void>
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

/** True when `ref` resolves to a commit in `repoPath`. */
async function refResolves(repoPath: string, ref: string): Promise<boolean> {
  return runGit(
    ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`],
    repoPath
  )
    .then(() => true)
    .catch(() => false)
}

/**
 * Build a {@link CloneManager} over an already-acquired mirror. Shared by both
 * acquisition paths — once a local `.git` exists, nothing below cares how it
 * got there.
 *
 * `upstreamUrl` is what each clone's `origin` is re-pointed at after cloning
 * from the mirror, so the Sandbox behaves like an ordinary clone of the real
 * source: pushes and pulls go to the true remote (over the host's own git
 * auth), never to the app-managed mirror. `null` keeps `origin` at the mirror —
 * the no-remote local-path case, where the user's clone *is* the upstream.
 */
function makeCloneManager(
  mirrorPath: string,
  clonesDir: string,
  upstreamUrl: string | null
): CloneManager {
  function clonePathFor(name: string): string {
    return path.join(clonesDir, name)
  }

  return {
    mirrorPath,
    clonePathFor,

    async createClone(name, ref, baseRevision): Promise<Clone> {
      const dest = clonePathFor(name)
      // Recreate semantics: a clone under the same Sandbox name is replaced,
      // never reused — Recreate must be a fresh checkout.
      await fs.rm(dest, { recursive: true, force: true })
      await fs.mkdir(clonesDir, { recursive: true })

      // Clone from the mirror *path* (not the remote URL): on the same
      // filesystem git hardlinks the object store, so the clone costs ≈ one
      // working tree and no network — and it works offline, off the commits the
      // mirror already has.
      await runGit(["clone", "--no-checkout", mirrorPath, dest])

      // Carry the mirror's last-known remote-tracking refs into the clone (a
      // path-clone only maps the mirror's *local* heads into `origin/*`).
      // Non-forced on purpose: a ref the clone already got from the mirror's
      // heads — e.g. a local-path user's branch that is ahead of the remote —
      // is never wound backwards. Best-effort: a mirror with no remote refs
      // simply contributes none.
      await runGit(
        ["fetch", mirrorPath, "refs/remotes/origin/*:refs/remotes/origin/*"],
        dest
      ).catch(() => {})

      // Re-point origin at the true upstream so the Sandbox is an ordinary
      // clone of the real source: push, pull, and conflict resolution behave
      // exactly as standard git against the real remote.
      if (upstreamUrl !== null) {
        await runGit(["remote", "set-url", "origin", upstreamUrl], dest)
      }

      // Check the ref out, resolving where a missing branch should start:
      //  1. a local head (the mirror's default branch materialized by clone);
      //  2. `origin/<ref>` — the branch exists on the remote (or in the
      //     local-path user's clone), tracked so push/pull line up;
      //  3. `origin/<base>` / `<base>` — the no-GitHub-API path (PRD #428):
      //     the branch is new everywhere, create it from the requested base;
      //  4. the clone's HEAD.
      if (await refResolves(dest, `refs/heads/${ref}`)) {
        await runGit(["checkout", ref], dest)
      } else if (await refResolves(dest, `refs/remotes/origin/${ref}`)) {
        await runGit(["checkout", "-b", ref, "--track", `origin/${ref}`], dest)
      } else {
        const args = ["checkout", "-b", ref]
        if (baseRevision) {
          if (await refResolves(dest, `refs/remotes/origin/${baseRevision}`)) {
            args.push(`origin/${baseRevision}`)
          } else if (await refResolves(dest, baseRevision)) {
            args.push(baseRevision)
          }
        }
        await runGit(args, dest)
      }

      return { ref, path: dest }
    },

    async removeClone(name): Promise<void> {
      await fs.rm(clonePathFor(name), { recursive: true, force: true })
    },
  }
}

/**
 * Acquire a Repo to a local `.git` (the shared per-source mirror) and return
 * the {@link CloneManager} both paths converge on. The only branch in the whole
 * flow:
 *
 * - **`local-path`** — validate the user's existing clone is a git working tree
 *   and use it as the mirror. The user's checkout is read, never written: every
 *   Sandbox gets its own clone of it, so a ref the user has checked out never
 *   blocks a Sandbox and Screenplay never touches their working tree. Each
 *   clone's `origin` is the user clone's own `origin` URL (riding their remotes
 *   and the host's git auth), or the user's clone itself when it has no remote.
 * - **`clone-url`** — `git clone` once into `<managedDir>/repo` (re-acquiring
 *   an already-cloned Repo reuses it), using the host's native git credentials
 *   so private repos work without the app ever holding a token. Each Sandbox
 *   clone's `origin` is the real URL.
 */
export async function acquireRepo(
  source: RepoSource,
  options: AcquireRepoOptions
): Promise<CloneManager> {
  const clonesDir = path.join(options.managedDir, "clones")

  if (source.type === "local-path") {
    const resolved = path.resolve(source.path)
    if (!(await isGitRepo(resolved))) {
      throw new Error(`Not a git repository: ${resolved}`)
    }
    // Normalize to the working-tree root so the mirror path is stable even
    // when the user points at a subdirectory of their clone.
    const mirrorPath = await runGit(["rev-parse", "--show-toplevel"], resolved)
    const upstreamUrl = await runGit(
      ["remote", "get-url", "origin"],
      mirrorPath
    ).catch(() => null)
    return makeCloneManager(mirrorPath, clonesDir, upstreamUrl)
  }

  const mirrorPath = path.join(options.managedDir, "repo")
  // Re-acquiring a Repo we've already cloned reuses the managed mirror rather
  // than failing on a non-empty target — clone is the one-time acquisition.
  if (!existsSync(mirrorPath) || !(await isGitRepo(mirrorPath))) {
    await fs.mkdir(options.managedDir, { recursive: true })
    await runGit(["clone", source.url, mirrorPath])
  }
  return makeCloneManager(mirrorPath, clonesDir, source.url)
}
