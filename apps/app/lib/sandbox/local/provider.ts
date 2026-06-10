import "server-only"

import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { acquireRepo, type RepoSource } from "@/lib/sandbox/local/worktree"
import { PortAllocator } from "@/lib/sandbox/port-allocator"
import type {
  SandboxCommandResult,
  SandboxCreateOptions,
  SandboxFile,
  SandboxGetOptions,
  SandboxGitSource,
  SandboxInstance,
  SandboxProvider,
  SandboxRunCommandOptions,
} from "@/lib/sandbox/types"

/**
 * Where the provider keeps its managed state, overridable via
 * `SCREENPLAY_WORKTREE_ROOT` (the desktop build points it at an app-data dir;
 * tests point it at a temp dir). Layout under the root:
 *
 *   managed/<hash>  one managed dir per acquisition source (clone URL or local
 *                  path), owned by `acquireRepo`: a `clone-url` source clones
 *                  once into `managed/<hash>/repo` (kept on a detached HEAD so
 *                  no ref is ever "checked out" there), a `local-path` source
 *                  keeps its `.git` where it is; either way per-Branch
 *                  worktrees land under `managed/<hash>/worktrees` (worktrees
 *                  of one repo share a single object store, which is the point
 *                  of using them — see ADR 0009)
 *   meta/<name>.json  the sandbox's main-clone dir, worktree dir, and allocated
 *                  port map, so `get`/`delete` can rebuild the instance and
 *                  free ports without re-deriving them
 *
 * (Two legacy generations still resolve and delete through the same paths:
 * pre-#428 sandboxes used `repos/<hash>` bare clones + `trees/<name>`
 * worktrees; the short-lived per-Sandbox-clone generation of #433 — reverted
 * by ADR 0009 — recorded `managed/<hash>/clones/<name>` as `cloneDir`.)
 */
function defaultRoot(): string {
  return (
    process.env.SCREENPLAY_WORKTREE_ROOT ??
    path.join(os.homedir(), ".screenplay", "worktrees")
  )
}

/** Persisted alongside each sandbox so `get` can rebuild its instance. */
interface SandboxMeta {
  /** The main clone this worktree was added from (for `git worktree remove`). */
  baseDir: string
  /** logical forwarded port → allocated distinct host port. */
  portMap: Record<string, number>
  /** Absolute worktree dir. Absent on pre-#428 metas (then `trees/<name>`). */
  worktreeDir?: string
  /** Legacy per-Sandbox clone dir from the reverted #433 generation. */
  cloneDir?: string
}

/**
 * Named, user-visible failure for opening a branch that another workspace on
 * this computer already has open. The desktop backend stores each Branch as a
 * git worktree, and git keeps one checkout per branch per repo — a structural
 * property of the storage model (ADR 0009), surfaced here instead of silently
 * stealing or sharing the other workspace's checkout. The hosted backend has
 * no such limit: independent clones per Sandbox.
 */
export class RefAlreadyOpenError extends Error {
  constructor(readonly ref: string) {
    super(
      `The branch "${ref}" is already open in another workspace on this ` +
        "computer. The desktop app keeps one checkout per branch, so close " +
        "the workspace that has it open, or open a different branch."
    )
    this.name = "RefAlreadyOpenError"
  }
}

/**
 * The **local** {@link SandboxProvider} — the desktop backend — backing each
 * Branch's Sandbox with a **git worktree on the host** instead of a remote VM.
 * It honors the portable core of the sandbox seam (ADR 0003) — `runCommand`,
 * `writeFiles` / `readFileToBuffer`, `domain`, `hostPort`, `delete`, plus the
 * `worktreePath` / `homeDir` path seams — so the agent's tool executor, logs
 * route, and terminal plumbing need no changes.
 *
 * Worktrees of one repo share a single object store — the point of using them
 * (ADR 0007/0009): one fetch serves every Branch and disk stays flat as the
 * repo grows. The structural consequence is **one checkout per ref**: on this
 * backend a git branch can back at most one Branch at a time, surfaced as the
 * named {@link RefAlreadyOpenError} (and {@link BranchCheckedOutInCloneError}
 * when the user's own clone holds the ref). This is a property of the desktop
 * storage model, not a domain rule — the hosted backend has no such limit.
 *
 * All Sandboxes share the host's network, so logical forwarded ports can't all
 * bind: each gets a distinct allocated host port, surfaced through the
 * `hostPort` seam (and through `domain`, which maps internally). That's what
 * lets two Branches' dev servers run side by side without fighting over 3000.
 *
 * It is **non-hibernating** on purpose: its instances do not implement
 * {@link HibernatingSandbox}, so `supportsHibernation` is false and the
 * lifecycle layer's portable "reclone fresh" branch is the active one. That
 * makes Recreate the live path (delete + re-add) and a Sandbox Restart fail
 * loud (nothing to snapshot), exactly as ADR 0003 / 0005 intend for a portable
 * backend.
 *
 * Durability flips relative to Vercel: a worktree lives on the host disk, so
 * the Sandbox *is* durable across process restarts (the checkout and its
 * uncommitted edits survive) even though it can't hibernate — durability is a
 * provider-dependent property, not tied to the hibernation capability.
 */
export class LocalSandboxProvider implements SandboxProvider {
  private readonly root: string
  private readonly ports = new PortAllocator()

  constructor(root: string = defaultRoot()) {
    this.root = root
  }

  async create(opts: SandboxCreateOptions): Promise<SandboxInstance> {
    if (opts.source.type !== "git" && opts.source.type !== "local-git") {
      // A portable backend has no snapshots to restore from; the lifecycle layer
      // never reaches create() with a snapshot source on a non-hibernating
      // provider (restartSandbox fails loud first), so this is a guard, not a path.
      throw new Error(
        `LocalSandboxProvider: unsupported source type "${opts.source.type}" ` +
          "(this backend does not hibernate, so it cannot restore from a snapshot)"
      )
    }
    const source = opts.source

    // Acquisition (issue #410, wired by #428): resolve the Repo to a local
    // `.git` — point at the user's existing clone, or clone the URL once into
    // the managed dir — and converge on the worktree manager. The paths
    // diverge only inside `acquireRepo`.
    const repoSource: RepoSource =
      source.type === "local-git"
        ? { type: "local-path", path: source.path }
        : { type: "clone-url", url: authedUrl(source) }
    const manager = await acquireRepo(repoSource, {
      managedDir: this.managedDirFor(repoSource),
    })

    // Best-effort refresh so a branch just created on the remote (e.g. via the
    // GitHub API) resolves; offline — or a local clone with no remote — must
    // not block adding a worktree off the commits already present.
    await git(manager.repoPath, ["fetch", "--prune", "origin"]).catch(() => {})
    if (repoSource.type === "clone-url") {
      // Detach the managed clone's HEAD so its default branch isn't "checked
      // out" anywhere: a Branch on that ref then gets a real worktree instead
      // of colliding with the managed clone's own working tree. Never done to
      // a local-path clone — that working tree belongs to the user.
      await git(manager.repoPath, ["checkout", "--detach"]).catch(() => {})
    }

    const ref = source.revision
    // One checkout per ref is structural here (worktrees). If another live
    // Sandbox owns this ref's worktree, fail loud instead of force-removing a
    // checkout that may hold its uncommitted work.
    const held = (await manager.listWorktrees()).find((w) => w.ref === ref)
    if (
      held &&
      path.resolve(held.path) !== path.resolve(manager.repoPath) &&
      (await this.worktreeOwnedByAnother(held.path, opts.name))
    ) {
      throw new RefAlreadyOpenError(ref)
    }
    // Re-creating an existing Sandbox (Recreate == remove + re-add), or
    // clearing a stale worktree no meta owns: make the add a fresh checkout.
    await manager.removeWorktree(ref)
    const startPoint = await resolveStartPoint(
      manager.repoPath,
      ref,
      source.baseRevision
    )
    const worktree = await manager.addWorktree(ref, startPoint)

    const portMap = await this.allocatePorts(opts.name, opts.ports)
    const meta: SandboxMeta = {
      baseDir: manager.repoPath,
      portMap,
      worktreeDir: worktree.path,
    }
    await this.writeMeta(opts.name, meta)

    return makeInstance(opts.name, worktree.path, portMap, () =>
      this.deleteSandbox(opts.name, meta)
    )
  }

  async get(opts: SandboxGetOptions): Promise<SandboxInstance> {
    const meta = await this.readMeta(opts.name)
    if (!meta) {
      throw new Error(`LocalSandboxProvider: no sandbox named "${opts.name}"`)
    }
    const dir =
      meta.worktreeDir ?? meta.cloneDir ?? this.legacyWtDirFor(opts.name)
    return makeInstance(opts.name, dir, meta.portMap, () =>
      this.deleteSandbox(opts.name, meta)
    )
  }

  private async deleteSandbox(name: string, meta: SandboxMeta): Promise<void> {
    if (!meta.worktreeDir && meta.cloneDir) {
      // Legacy #433-generation sandbox: an independent clone releases
      // everything when its directory goes — no bookkeeping to unwind.
      await fs.rm(meta.cloneDir, { recursive: true, force: true })
    } else {
      const wtDir = meta.worktreeDir ?? this.legacyWtDirFor(name)
      // A worktree that resolved to the *main clone* (a legacy aliased meta —
      // e.g. a local-path Repo's own branch, before that became a fail-loud
      // error) is never removed: the fallback hard-delete below would destroy
      // the user's clone. Releasing the ports and meta is the whole teardown
      // then.
      if (path.resolve(wtDir) !== path.resolve(meta.baseDir)) {
        await this.removeWorktree(meta.baseDir, wtDir)
      }
    }
    for (const logical of Object.keys(meta.portMap)) {
      this.ports.release(portKey(name, Number(logical)))
    }
    await fs.rm(this.metaPathFor(name), { force: true })
  }

  /** Remove a worktree if present, pruning the stale admin entry afterward. */
  private async removeWorktree(baseDir: string, wtDir: string): Promise<void> {
    if (!(await exists(wtDir))) return
    await git(baseDir, ["worktree", "remove", "--force", wtDir]).catch(
      async () => {
        // The admin link can be inconsistent (e.g. the dir was removed out from
        // under git); fall back to a hard delete + prune so a stale entry never
        // wedges a later add.
        await fs.rm(wtDir, { recursive: true, force: true })
        await git(baseDir, ["worktree", "prune"]).catch(() => {})
      }
    )
  }

  /** True when a sandbox other than `selfName` records `wtDir` as its checkout. */
  private async worktreeOwnedByAnother(
    wtDir: string,
    selfName: string
  ): Promise<boolean> {
    const metaDir = path.join(this.root, "meta")
    let entries: string[]
    try {
      entries = await fs.readdir(metaDir)
    } catch {
      return false
    }
    const target = path.resolve(wtDir)
    for (const entry of entries) {
      if (!entry.endsWith(".json")) continue
      const name = entry.slice(0, -".json".length)
      if (name === selfName) continue
      const meta = await this.readMeta(name)
      if (meta?.worktreeDir && path.resolve(meta.worktreeDir) === target) {
        return true
      }
    }
    return false
  }

  private async allocatePorts(
    name: string,
    ports: number[]
  ): Promise<Record<string, number>> {
    const portMap: Record<string, number> = {}
    for (const logical of ports) {
      portMap[String(logical)] = await this.ports.allocate(
        portKey(name, logical)
      )
    }
    return portMap
  }

  /**
   * One managed dir per acquisition source. Keyed by the URL or the local
   * path, so every Branch of the same Repo converges on the same manager —
   * and namespaced away from the pre-#428 `repos/<hash>` bare clones, whose
   * layout (`.git` files pointing into a bare repo) the manager can't adopt.
   */
  private managedDirFor(source: RepoSource): string {
    const key = source.type === "local-path" ? source.path : source.url
    const hash = createHash("sha1").update(key).digest("hex").slice(0, 16)
    return path.join(this.root, "managed", hash)
  }

  /** Where pre-#428 metas (no `worktreeDir`/`cloneDir`) kept their checkout. */
  private legacyWtDirFor(name: string): string {
    return path.join(this.root, "trees", name)
  }

  private metaPathFor(name: string): string {
    return path.join(this.root, "meta", `${name}.json`)
  }

  private async writeMeta(name: string, meta: SandboxMeta): Promise<void> {
    const file = this.metaPathFor(name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(meta), "utf8")
  }

  private async readMeta(name: string): Promise<SandboxMeta | null> {
    try {
      const raw = await fs.readFile(this.metaPathFor(name), "utf8")
      return JSON.parse(raw) as SandboxMeta
    } catch {
      return null
    }
  }
}

/** Per-(Sandbox, forwarded-port) allocator key. */
function portKey(name: string, logicalPort: number): string {
  return `${name}:${logicalPort}`
}

/** True when `ref` resolves to a commit in `repoPath`. */
async function refResolves(repoPath: string, ref: string): Promise<boolean> {
  return git(repoPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])
    .then(() => true)
    .catch(() => false)
}

/**
 * Where a worktree's branch should start when `ref` doesn't exist locally yet
 * (when it does, the manager just checks it out and this value is unused):
 *
 *  1. `origin/<ref>` — the branch exists on the remote (e.g. just created via
 *     the GitHub API, or the user picked an existing remote branch);
 *  2. `origin/<base>` / `<base>` — the no-API path (PRD #428): the branch is
 *     new everywhere, so create it locally from the requested base;
 *  3. `undefined` — fall through to the clone's HEAD.
 */
async function resolveStartPoint(
  repoPath: string,
  ref: string,
  baseRevision: string | undefined
): Promise<string | undefined> {
  if (await refResolves(repoPath, `refs/heads/${ref}`)) return undefined
  if (await refResolves(repoPath, `refs/remotes/origin/${ref}`)) {
    return `origin/${ref}`
  }
  if (baseRevision) {
    if (await refResolves(repoPath, `refs/remotes/origin/${baseRevision}`)) {
      return `origin/${baseRevision}`
    }
    if (await refResolves(repoPath, baseRevision)) return baseRevision
  }
  return undefined
}

/**
 * Build the {@link SandboxInstance} surface over a host worktree directory. All
 * file ops resolve relative paths against the worktree and pass absolute paths
 * (e.g. `/tmp/screenplay/...`) straight through, matching how the Vercel backend
 * treats the two. `delete` is supplied by the provider as `onDelete` (it needs
 * the meta to reclaim ports and remove the right generation's checkout), so
 * both `create`- and `get`-returned instances can tear themselves down.
 */
function makeInstance(
  name: string,
  wtDir: string,
  portMap: Record<string, number>,
  onDelete?: () => Promise<void>
): SandboxInstance {
  const hostPort = (port: number): number => portMap[String(port)] ?? port
  return {
    name,
    worktreePath: wtDir,
    // Ordinary host commands run as the current user, so the writable home that
    // user-level config is seeded into is just the host `$HOME`. This is also
    // what keeps the user's authenticated Harnesses (Claude Code et al.,
    // subscription auth included) available inside every Sandbox.
    homeDir: os.homedir(),
    // Every Sandbox shares the host's network, so logical ports resolve through
    // the per-Sandbox allocation — stable for this Sandbox, distinct across
    // Sandboxes. `domain` maps through the same table so the advertised preview
    // URL and the port the proxy actually binds always agree.
    hostPort,
    domain(port: number): string {
      return `http://localhost:${hostPort(port)}`
    },
    runCommand(
      cmdOrOpts: SandboxRunCommandOptions | string,
      maybeArgs?: string[]
    ): Promise<SandboxCommandResult> {
      const opts: SandboxRunCommandOptions =
        typeof cmdOrOpts === "string"
          ? { cmd: cmdOrOpts, args: maybeArgs ?? [] }
          : cmdOrOpts
      return execHost(wtDir, opts)
    },
    async writeFiles(files: SandboxFile[]): Promise<void> {
      await Promise.all(
        files.map(async (file) => {
          const abs = resolveIn(wtDir, file.path)
          await fs.mkdir(path.dirname(abs), { recursive: true })
          await fs.writeFile(abs, file.content)
        })
      )
    },
    async readFileToBuffer({
      path: p,
    }: {
      path: string
    }): Promise<Buffer | null> {
      try {
        return await fs.readFile(resolveIn(wtDir, p))
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return null
        throw e
      }
    },
    async delete(): Promise<void> {
      await onDelete?.()
    },
  }
}

function resolveIn(wtDir: string, p: string): string {
  return path.isAbsolute(p) ? p : path.join(wtDir, p)
}

/**
 * Run a command as a host process with `cwd` set to the worktree. A non-detached
 * call buffers stdout/stderr and resolves on exit with the real exit code; a
 * detached call resolves as soon as the child is spawned (exit code 0) and keeps
 * running — matching the contract `launchDevAndProxy` relies on for the dev
 * server and bridge proxy. `sudo` is ignored: host commands already run as the
 * user, and the only sudo callers (ripgrep / harness installs) are best-effort.
 */
function execHost(
  cwd: string,
  opts: SandboxRunCommandOptions
): Promise<SandboxCommandResult> {
  const detached = opts.detached ?? false
  const child = spawn(opts.cmd, opts.args ?? [], {
    cwd,
    env: { ...process.env, ...(opts.env ?? {}) },
    detached,
  })

  let stdout = ""
  let stderr = ""
  child.stdout?.on("data", (d: Buffer) => {
    stdout += d.toString()
  })
  child.stderr?.on("data", (d: Buffer) => {
    stderr += d.toString()
  })

  const kill = async (): Promise<void> => {
    if (child.pid == null) return
    try {
      // A detached child leads its own process group, so the negative PID takes
      // down the whole tree (the dev server and its compile workers); otherwise
      // signal the single process.
      if (detached) process.kill(-child.pid, "SIGKILL")
      else child.kill("SIGKILL")
    } catch {
      // Already gone — nothing to kill.
    }
  }

  const result = (exitCode: number): SandboxCommandResult => ({
    exitCode,
    stdout: async () => stdout,
    stderr: async () => stderr,
    logs: () => streamLogs(child),
    kill,
  })

  if (detached) {
    child.unref()
    return Promise.resolve(result(0))
  }

  return new Promise((resolve) => {
    child.on("error", () => resolve(result(1)))
    child.on("close", (code) => resolve(result(code ?? 0)))
  })
}

/**
 * Stream a child's combined stdout/stderr line-chunks as they arrive, ending
 * when the process closes. Backs the detached `logs()` affordance; the buffered
 * `stdout()` / `stderr()` accessors above cover the non-streaming readers.
 */
async function* streamLogs(
  child: ChildProcess
): AsyncIterable<{ data: string }> {
  const queue: string[] = []
  let notify: (() => void) | null = null
  let ended = false

  const push = (chunk: Buffer) => {
    queue.push(chunk.toString())
    notify?.()
    notify = null
  }
  child.stdout?.on("data", push)
  child.stderr?.on("data", push)
  child.on("close", () => {
    ended = true
    notify?.()
    notify = null
  })

  while (true) {
    if (queue.length > 0) {
      yield { data: queue.shift()! }
      continue
    }
    if (ended) return
    await new Promise<void>((resolve) => {
      notify = resolve
    })
  }
}

/**
 * Bake optional credentials into the clone URL the way the Vercel provider does
 * — callers pass a GitHub token as `password` with `username = "x-access-token"`.
 * A credential-free source (public repo, or a local `file://` / path used in
 * tests) is cloned as-is.
 */
function authedUrl(source: SandboxGitSource): string {
  if (!source.username && !source.password) return source.url
  try {
    const url = new URL(source.url)
    if (source.username) url.username = source.username
    if (source.password) url.password = source.password
    return url.toString()
  } catch {
    // Not a URL we can splice creds into (e.g. a bare filesystem path); use it
    // verbatim.
    return source.url
  }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** Run `git` in `cwd`, rejecting with stderr on a non-zero exit. */
function git(cwd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, { cwd })
    let stderr = ""
    child.stderr?.on("data", (d: Buffer) => {
      stderr += d.toString()
    })
    child.on("error", reject)
    child.on("close", (code) => {
      if (code === 0) resolve()
      else
        reject(
          new Error(`git ${args.join(" ")} failed (exit ${code}): ${stderr}`)
        )
    })
  })
}

let cached: LocalSandboxProvider | null = null
export function getLocalSandboxProvider(): SandboxProvider {
  if (!cached) cached = new LocalSandboxProvider()
  return cached
}
