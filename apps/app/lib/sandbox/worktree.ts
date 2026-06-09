import "server-only"

import { spawn, type ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

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
 *   repos/<hash>   a bare clone per source URL — the shared object store every
 *                  Branch's worktree is added from (worktrees of the same repo
 *                  reuse it, which is the whole point of using worktrees)
 *   trees/<name>   one checked-out worktree per Sandbox (== per Branch)
 *   meta/<name>.json  the worktree's base-repo dir + its allocated port map,
 *                  so `get`/`delete` can rebuild the instance and free ports
 *                  without re-deriving them
 */
function defaultRoot(): string {
  return (
    process.env.SCREENPLAY_WORKTREE_ROOT ??
    path.join(os.homedir(), ".screenplay", "worktrees")
  )
}

/** Persisted alongside each worktree so `get` can rebuild its instance. */
interface WorktreeMeta {
  /** The bare clone this worktree was added from (for `git worktree remove`). */
  baseDir: string
  /** logical forwarded port → allocated distinct host port. */
  portMap: Record<string, number>
}

/**
 * Local {@link SandboxProvider} that backs each Branch's Sandbox with a **git
 * worktree on the host** instead of a remote VM. It honors the portable core of
 * the sandbox seam (ADR 0003) — `runCommand`, `writeFiles` / `readFileToBuffer`,
 * `domain`, `delete`, plus the `worktreePath` / `homeDir` path seams — so the
 * agent's tool executor, logs route, and terminal plumbing need no changes.
 *
 * It is **non-hibernating** on purpose: its instances do not implement
 * {@link HibernatingSandbox}, so `supportsHibernation` is false and the
 * lifecycle layer's portable "reclone fresh" branch is the active one. That
 * makes Recreate the live path (delete + re-add) and a Sandbox Restart fail
 * loud (nothing to snapshot), exactly as ADR 0003 / 0005 intend for a portable
 * backend.
 *
 * Durability flips relative to Vercel: a worktree lives on the host disk, so the
 * Sandbox *is* durable across process restarts (the checkout and its uncommitted
 * edits survive) even though it can't hibernate — durability is now a
 * provider-dependent property, not tied to the hibernation capability.
 */
export class WorktreeSandboxProvider implements SandboxProvider {
  private readonly root: string
  private readonly ports = new PortAllocator()

  constructor(root: string = defaultRoot()) {
    this.root = root
  }

  async create(opts: SandboxCreateOptions): Promise<SandboxInstance> {
    if (opts.source.type !== "git") {
      // A portable backend has no snapshots to restore from; the lifecycle layer
      // never reaches create() with a snapshot source on a non-hibernating
      // provider (restartSandbox fails loud first), so this is a guard, not a path.
      throw new Error(
        `WorktreeSandboxProvider: unsupported source type "${opts.source.type}" ` +
          "(this backend does not hibernate, so it cannot restore from a snapshot)"
      )
    }

    const baseDir = this.baseDirFor(opts.source.url)
    await this.ensureBaseClone(baseDir, opts.source)

    const wtDir = this.wtDirFor(opts.name)
    // Re-creating an existing Sandbox (Recreate == remove + re-add): clear any
    // prior worktree at this path so the add is clean.
    await this.removeWorktree(baseDir, wtDir)
    await git(baseDir, [
      "worktree",
      "add",
      "--force",
      wtDir,
      opts.source.revision,
    ])

    const portMap = await this.allocatePorts(opts.name, opts.ports)
    const meta: WorktreeMeta = { baseDir, portMap }
    await this.writeMeta(opts.name, meta)

    return makeInstance(opts.name, wtDir, portMap, () =>
      this.deleteSandbox(opts.name, meta)
    )
  }

  async get(opts: SandboxGetOptions): Promise<SandboxInstance> {
    const meta = await this.readMeta(opts.name)
    if (!meta) {
      throw new Error(
        `WorktreeSandboxProvider: no sandbox named "${opts.name}"`
      )
    }
    const wtDir = this.wtDirFor(opts.name)
    return makeInstance(opts.name, wtDir, meta.portMap, () =>
      this.deleteSandbox(opts.name, meta)
    )
  }

  private async deleteSandbox(name: string, meta: WorktreeMeta): Promise<void> {
    const wtDir = this.wtDirFor(name)
    await this.removeWorktree(meta.baseDir, wtDir)
    for (const logical of Object.keys(meta.portMap)) {
      this.ports.release(portKey(name, Number(logical)))
    }
    await fs.rm(this.metaPathFor(name), { force: true })
  }

  /**
   * Clone the source into a bare repo on first use; reuse it (best-effort fetch)
   * on subsequent Branches of the same repo. Bare so the shared object store has
   * no checked-out branch of its own to collide with a worktree's.
   */
  private async ensureBaseClone(
    baseDir: string,
    source: SandboxGitSource
  ): Promise<void> {
    if (await exists(baseDir)) {
      // Best-effort refresh; an offline/unreachable remote must not block adding
      // a worktree off the commits already present.
      await git(baseDir, ["fetch", "--prune", "origin"]).catch(() => {})
      return
    }
    await fs.mkdir(path.dirname(baseDir), { recursive: true })
    await git(process.cwd(), ["clone", "--bare", authedUrl(source), baseDir])
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

  private baseDirFor(url: string): string {
    const hash = createHash("sha1").update(url).digest("hex").slice(0, 16)
    return path.join(this.root, "repos", hash)
  }

  private wtDirFor(name: string): string {
    return path.join(this.root, "trees", name)
  }

  private metaPathFor(name: string): string {
    return path.join(this.root, "meta", `${name}.json`)
  }

  private async writeMeta(name: string, meta: WorktreeMeta): Promise<void> {
    const file = this.metaPathFor(name)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, JSON.stringify(meta), "utf8")
  }

  private async readMeta(name: string): Promise<WorktreeMeta | null> {
    try {
      const raw = await fs.readFile(this.metaPathFor(name), "utf8")
      return JSON.parse(raw) as WorktreeMeta
    } catch {
      return null
    }
  }
}

/** Per-(Sandbox, forwarded-port) allocator key. */
function portKey(name: string, logicalPort: number): string {
  return `${name}:${logicalPort}`
}

/**
 * Build the {@link SandboxInstance} surface over a host worktree directory. All
 * file ops resolve relative paths against the worktree and pass absolute paths
 * (e.g. `/tmp/screenplay/...`) straight through, matching how the Vercel backend
 * treats the two. `delete` is supplied by the provider as `onDelete` (it needs
 * the base repo to run `git worktree remove` and the port map to reclaim ports),
 * so both `create`- and `get`-returned instances can tear themselves down.
 */
function makeInstance(
  name: string,
  wtDir: string,
  portMap: Record<string, number>,
  onDelete?: () => Promise<void>
): SandboxInstance {
  return {
    name,
    worktreePath: wtDir,
    // Ordinary host commands run as the current user, so the writable home that
    // user-level config is seeded into is just the host `$HOME`.
    homeDir: os.homedir(),
    domain(port: number): string {
      const host = portMap[String(port)] ?? port
      return `http://localhost:${host}`
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

let cached: WorktreeSandboxProvider | null = null
export function getWorktreeSandboxProvider(): SandboxProvider {
  if (!cached) cached = new WorktreeSandboxProvider()
  return cached
}
