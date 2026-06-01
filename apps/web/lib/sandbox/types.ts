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

export type SandboxSource = SandboxGitSource | SandboxSnapshotSource

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
  /** When true, reboot a stopped sandbox from its snapshot. */
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
 * The server-facing surface of a live sandbox VM. Concrete providers (Vercel
 * Sandbox, E2B, Modal, a local Docker container, etc.) return instances of
 * this shape from {@link SandboxProvider.create} / {@link SandboxProvider.get}.
 */
export interface SandboxInstance {
  readonly name: string
  /** Lifecycle state. Callers compare against `"running"`. */
  readonly status: string
  /**
   * Absolute path the repo is checked out into — the agent's working directory
   * and the project root the harness trusts. `/vercel/sandbox` on Vercel.
   * Provider-supplied so workflow code never hardcodes a backend's layout (e.g.
   * the pre-seeded `.claude.json` project key is derived from this).
   */
  readonly worktreePath: string
  /**
   * Absolute path to the home directory commands run against (`$HOME`). `/root`
   * on Vercel. User-level config (`.claude.json`, `.claude/CLAUDE.md`, the git
   * credential helper) is seeded here, so the writable-home location is
   * provider-supplied rather than an assumed `/tmp`-vs-`$HOME` split.
   */
  readonly homeDir: string
  /** Public URL for the given forwarded port. */
  domain(port: number): string
  runCommand(opts: SandboxRunCommandOptions): Promise<SandboxCommandResult>
  runCommand(cmd: string, args?: string[]): Promise<SandboxCommandResult>
  writeFiles(files: SandboxFile[]): Promise<void>
  /** Returns `null` if the file does not exist. */
  readFileToBuffer(opts: { path: string }): Promise<Buffer | null>
  /** Extend the auto-stop timer by `ms` milliseconds. */
  extendTimeout(ms: number): Promise<void>
  /**
   * Capture a filesystem snapshot of the running sandbox. The sandbox stops as
   * a side effect — no further commands can run on this instance afterwards.
   * The returned `snapshotId` can be passed to {@link SandboxProvider.create}
   * via a {@link SandboxSnapshotSource} to boot a new VM from this state.
   */
  snapshot(opts?: { expiration?: number }): Promise<{ snapshotId: string }>
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
 * Transitional note: the core {@link SandboxInstance} above still re-declares
 * `snapshot()` and `extendTimeout()` so existing call sites keep compiling.
 * Conceptually those belong to this capability — *removing* them from the core
 * (so the types make hibernation unreachable without the guard, and `status`
 * gives way to `isRunning()`) is the follow-up tightening step. For now the
 * guard discriminates on `isRunning`, the one method the core does not carry.
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
 * capability by the presence of `isRunning`, the one method the core does not
 * carry, so it stays a reliable discriminator even while `snapshot()` /
 * `extendTimeout()` still live on the core during the transition.
 */
export function supportsHibernation(s: SandboxInstance): s is HibernatingSandbox {
  return typeof (s as Partial<HibernatingSandbox>).isRunning === "function"
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
