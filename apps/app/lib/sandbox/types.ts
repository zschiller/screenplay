import "server-only"

/**
 * A git source a sandbox can be provisioned from. Credentials are optional so
 * public repos can be cloned without passing auth. When set, `username` /
 * `password` are baked into the clone URL the provider issues — callers pass
 * the GitHub token in `password` with `username = "x-access-token"`.
 */
export type SandboxGitSource = {
  type: "git"
  url: string
  revision: string
  username?: string
  password?: string
  /**
   * Ref to create `revision` from when it doesn't exist anywhere yet — the
   * no-GitHub-API path on the local build (PRD #428), where a new Branch's git
   * branch is created locally at provision time instead of via the API. The
   * Vercel backend ignores this (its branches are always API-created first).
   */
  baseRevision?: string
}

/**
 * A repo the user already has on disk (PRD #428): provision roots the
 * worktree manager at this existing clone instead of cloning a URL, riding
 * the clone's own remotes and the host's git auth. Only the local worktree
 * backend can honor it — a remote-VM provider has no host filesystem to
 * point at, so it rejects this source the way a portable backend rejects a
 * snapshot.
 */
export type SandboxLocalGitSource = {
  type: "local-git"
  /** Absolute path of the existing clone (any directory inside it works). */
  path: string
  revision: string
  /** Same contract as {@link SandboxGitSource.baseRevision}. */
  baseRevision?: string
  /**
   * Glob patterns (relative to the checkout root, e.g. `.env*`) of files to
   * copy from the original checkout into the fresh worktree after checkout.
   * This is how gitignored config a dev server needs — `.env*` above all —
   * reaches a worktree that git alone would leave bare of it.
   */
  copyPatterns?: string[]
}

/**
 * A previously-captured filesystem snapshot. Restoring from a snapshot brings
 * back the entire working tree (including uncommitted changes) and avoids
 * re-running setup scripts — much faster than a fresh git clone, and the only
 * way to preserve in-sandbox state across a restart.
 */
export type SandboxSnapshotSource = {
  type: "snapshot"
  snapshotId: string
}

export type SandboxSource =
  | SandboxGitSource
  | SandboxLocalGitSource
  | SandboxSnapshotSource

/**
 * A firewall rule. Providers that support transforms rewrite outgoing requests
 * matching the host (e.g. injecting an Anthropic key header at egress so the
 * sandbox never sees the real key). An empty array means "allow end-to-end
 * with no modifications"; `"*"` keys match unspecified hosts. Providers that
 * don't support network policies may ignore this field entirely.
 */
export interface SandboxNetworkPolicyRule {
  transform?: { headers?: Record<string, string> }[]
}

export interface SandboxNetworkPolicy {
  allow: Record<string, SandboxNetworkPolicyRule[]>
}

export interface SandboxCreateOptions {
  name: string
  source: SandboxSource
  ports: number[]
  /** Auto-stop after this many ms of inactivity. */
  timeout: number
  /** How long the filesystem snapshot survives once the VM stops. */
  snapshotExpiration?: number
  resources?: { vcpus: number }
  env?: Record<string, string>
  networkPolicy?: SandboxNetworkPolicy
}

export interface SandboxGetOptions {
  name: string
  /**
   * When true, reboot a stopped sandbox from its snapshot. Only a hibernating
   * provider (see {@link HibernatingSandbox}) can honor this — booting a stopped
   * VM is the resume affordance of that capability. A portable backend has no
   * stopped-but-present state to wake, so it ignores the flag.
   */
  resume?: boolean
}

export interface SandboxRunCommandOptions {
  cmd: string
  args?: string[]
  env?: Record<string, string>
  /** Return immediately without waiting for the command to exit. */
  detached?: boolean
  /** Run as root. */
  sudo?: boolean
}

/**
 * Handle to a running (or completed) command. `stdout`/`stderr` buffer the
 * full output; `logs` streams it line by line for detached commands.
 */
export interface SandboxCommandResult {
  readonly exitCode: number
  stdout(): Promise<string>
  stderr(): Promise<string>
  logs(opts?: { signal?: AbortSignal }): AsyncIterable<{ data: string }>
  kill(): Promise<void>
}

export interface SandboxFile {
  path: string
  content: string | Buffer
}

/**
 * The portable core surface of a live sandbox VM — only the operations every
 * backend (Vercel Sandbox, E2B, Modal, a local Docker container, etc.) can
 * honor. Concrete providers return instances of this shape from
 * {@link SandboxProvider.create} / {@link SandboxProvider.get}.
 *
 * Deliberately small: no `status`, `snapshot`, or `extendTimeout`. Those are the
 * **hibernation** capability and live on {@link HibernatingSandbox}, reachable
 * only by narrowing through {@link supportsHibernation}. Liveness is read with
 * the portable {@link isSandboxRunning} predicate, never a stringly-typed
 * `status === "running"` comparison. Keeping the core this lean is what forces a
 * provider to either implement hibernation completely or fall through to the
 * reclone path — a half-implementation no longer type-checks.
 */
export interface SandboxInstance {
  readonly name: string
  /**
   * Absolute path the repo is checked out into — the agent's working directory
   * and the project root the harness trusts. `/vercel/sandbox` on Vercel.
   * Provider-supplied so workflow code never hardcodes a backend's layout (e.g.
   * the pre-seeded `.claude.json` project key is derived from this).
   */
  readonly worktreePath: string
  /**
   * Absolute path to the home directory of the unprivileged user that ordinary
   * (non-`sudo`) commands and the interactive terminal shell run as — i.e. the
   * `$HOME` that `claude` resolves in the tmux session. `/home/vercel-sandbox`
   * on Vercel (NOT `/root`, which only `sudo`/root commands see and which the
   * sandbox user can't even read). User-level config (`.claude.json`,
   * `.claude/CLAUDE.md`, the git credential helper) is seeded here, so the
   * writable-home location is provider-supplied rather than an assumed
   * `/tmp`-vs-`$HOME` split.
   */
  readonly homeDir: string
  /** Public URL for the given forwarded port. */
  domain(port: number): string
  /**
   * Resolve a logical forwarded port to the port a process must actually
   * **bind** (and that other in-sandbox processes can reach it on). On a backend
   * whose sandbox owns its network namespace (the hosted Vercel VM) this is the
   * identity. On the local backend every Sandbox shares the host's network, so
   * each logical port maps to a distinct allocated host port — stable per
   * Sandbox, distinct across Sandboxes. The resolved Dev Server Port is what the
   * dev command receives as `$SCREENPLAY_PORT` / `$PORT`, what the bridge proxy
   * binds and upstreams to, and what the terminal daemon listens on. Callers
   * must never assume logical == bound; `domain(port)` keeps taking the
   * *logical* port and does its own mapping.
   */
  hostPort(port: number): number
  runCommand(opts: SandboxRunCommandOptions): Promise<SandboxCommandResult>
  runCommand(cmd: string, args?: string[]): Promise<SandboxCommandResult>
  writeFiles(files: SandboxFile[]): Promise<void>
  /** Returns `null` if the file does not exist. */
  readFileToBuffer(opts: { path: string }): Promise<Buffer | null>
  /** Delete the sandbox. After deletion the instance is inert. */
  delete(): Promise<void>
}

/**
 * The optional **hibernation** capability: snapshot / resume / auto-stop-timeout.
 * Extends the portable core with the operations only a backend that can freeze
 * and thaw a VM can honor:
 *
 * - `snapshot()` — capture the filesystem and stop the VM.
 * - `extendTimeout()` — push back the auto-stop timer (the keep-alive heartbeat).
 * - `isRunning()` — liveness, replacing a stringly-typed `status === "running"`.
 * - the **resume affordance** — booting a stopped VM back up, reached through
 *   {@link SandboxProvider.get} with `resume: true`.
 *
 * Reached only by narrowing a core instance through {@link supportsHibernation};
 * the guard's `else` branch is always the portable "reclone fresh" path. A
 * provider that can't hibernate degrades to recloning rather than calling
 * methods that mean nothing to it.
 *
 * `snapshot()` and `extendTimeout()` live here, not on the core, so they are
 * unreachable without narrowing through the guard — the compiler now enforces
 * that a provider either supplies the whole capability or none of it.
 */
export interface HibernatingSandbox extends SandboxInstance {
  /** True while the VM is up and serving — the portable liveness predicate. */
  isRunning(): boolean
  snapshot(opts?: { expiration?: number }): Promise<{ snapshotId: string }>
  extendTimeout(ms: number): Promise<void>
}

/**
 * Type guard narrowing a core {@link SandboxInstance} to a
 * {@link HibernatingSandbox}. This guard — not optional methods, not a
 * capabilities bag — is the decision: hibernation methods are unreachable
 * without narrowing through it, so the reclone-fresh fallback can't be silently
 * forgotten and a half-implementing provider can't slip through. Detects the
 * capability by the presence of `isRunning`; with `snapshot()` / `extendTimeout()`
 * now off the core, that method is the sole discriminator the core never carries.
 */
export function supportsHibernation(
  s: SandboxInstance
): s is HibernatingSandbox {
  return typeof (s as Partial<HibernatingSandbox>).isRunning === "function"
}

/**
 * Portable liveness predicate, replacing the stringly-typed
 * `status === "running"` checks that assumed a Vercel-shaped `status` field on
 * every instance. A hibernating sandbox can be stopped while its handle still
 * exists, so its own {@link HibernatingSandbox.isRunning} is authoritative; a
 * portable instance has no stopped-but-present state, so it is live for as long
 * as the handle does — the provider returning it is proof enough.
 */
export function isSandboxRunning(s: SandboxInstance): boolean {
  return supportsHibernation(s) ? s.isRunning() : true
}

/**
 * A factory for sandbox VMs. Implementations are interchangeable as long as
 * the returned {@link SandboxInstance} objects honor the contract above — the
 * higher-level sandbox workflows in `lib/sandbox/*` are written against this
 * interface, not any specific SDK. A provider whose instances also satisfy
 * {@link HibernatingSandbox} additionally supports snapshot/resume/timeout;
 * one whose instances do not falls through to the portable reclone path.
 */
export interface SandboxProvider {
  create(opts: SandboxCreateOptions): Promise<SandboxInstance>
  get(opts: SandboxGetOptions): Promise<SandboxInstance>
}
