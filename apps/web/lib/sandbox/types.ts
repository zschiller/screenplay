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
 * A factory for sandbox VMs. Implementations are interchangeable as long as
 * the returned {@link SandboxInstance} objects honor the contract above — the
 * higher-level sandbox workflows in `lib/sandbox/*` are written against this
 * interface, not any specific SDK.
 */
export interface SandboxProvider {
  create(opts: SandboxCreateOptions): Promise<SandboxInstance>
  get(opts: SandboxGetOptions): Promise<SandboxInstance>
}
