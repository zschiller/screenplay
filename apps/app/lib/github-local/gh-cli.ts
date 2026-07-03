import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

/**
 * The host-process boundary the adapter shells through, injected so detection
 * and token extraction are testable without a real `gh` install (the same
 * mockable-seam shape as the sandbox command runner). Resolves with the exit
 * code + output for a process that ran; **rejects** when the binary can't be
 * spawned at all (ENOENT), which the adapter maps to "unavailable".
 */
export type GhProcessRunner = (
  cmd: string,
  args: string[]
) => Promise<{ exitCode: number; stdout: string }>

/**
 * The three states the host `gh` CLI can be in, kept distinct instead of
 * collapsing the first two to `null` the way {@link GhCli.getToken} does
 * (ADR 0014). The Settings GitHub section needs the difference to tell a user
 * to *install* `gh` versus to *sign in* — the resolver only ever cared about
 * whether a token fell out.
 */
export type GhStatus =
  | { kind: "not-installed" }
  | { kind: "installed-not-authenticated" }
  | { kind: "authenticated"; token: string; handle: string | null }

/**
 * Thin adapter over the host's GitHub CLI (PRD #428). One question, two
 * answers: is `gh` installed *and* authenticated, and if so what token is it
 * holding? Backed by `gh auth token`, which prints the active account's token
 * on exit 0 and fails when logged out. The sidecar runs as a host Node
 * process, so shelling out is in-context — this is the zero-config path that
 * lights up the GitHub API for anyone who already uses `gh`.
 */
export interface GhCli {
  /**
   * The CLI's current token, or `null` when `gh` is missing, unauthenticated,
   * or otherwise unusable. Never throws — an absent `gh` is an expected state
   * (the resolver just falls through to the token store), not an error.
   */
  getToken(): Promise<string | null>
  /**
   * The finer three-state view the connection UI reads: *not installed* (can't
   * spawn / non-zero `gh --version`), *installed but signed out* (no token),
   * or *authenticated* with the token and, best-effort, the connected handle.
   * Never throws — every failure resolves to the nearest honest state.
   */
  getStatus(): Promise<GhStatus>
}

const defaultRunner: GhProcessRunner = async (cmd, args) => {
  try {
    const { stdout } = await execFileAsync(cmd, args, { timeout: 10_000 })
    return { exitCode: 0, stdout }
  } catch (err) {
    const e = err as { code?: number | string; stdout?: string }
    // A numeric code is a real exit status (ran, but failed — e.g. logged
    // out). A string code (ENOENT) means the binary isn't there; rethrow so
    // the adapter's catch maps it to unavailable like any other spawn failure.
    if (typeof e.code === "number") {
      return { exitCode: e.code, stdout: e.stdout ?? "" }
    }
    throw err
  }
}

export function makeGhCli(run: GhProcessRunner = defaultRunner): GhCli {
  async function getToken(): Promise<string | null> {
    try {
      const result = await run("gh", ["auth", "token"])
      if (result.exitCode !== 0) return null
      const token = result.stdout.trim()
      return token === "" ? null : token
    } catch {
      return null
    }
  }

  /**
   * Whether `gh` can be run at all. `gh --version` exits 0 on any install and
   * needs no auth, so it isolates "is the binary here" from "is it signed in".
   */
  async function isInstalled(): Promise<boolean> {
    try {
      const result = await run("gh", ["--version"])
      return result.exitCode === 0
    } catch {
      return false
    }
  }

  /**
   * The connected account's login, read once we know a token exists. Purely to
   * label the authed state — a failure here (offline, an old `gh`) degrades to
   * `null` and never demotes the connection.
   */
  async function getHandle(): Promise<string | null> {
    try {
      const result = await run("gh", ["api", "user", "--jq", ".login"])
      if (result.exitCode !== 0) return null
      const handle = result.stdout.trim()
      return handle === "" ? null : handle
    } catch {
      return null
    }
  }

  async function getStatus(): Promise<GhStatus> {
    if (!(await isInstalled())) return { kind: "not-installed" }
    const token = await getToken()
    if (!token) return { kind: "installed-not-authenticated" }
    return { kind: "authenticated", token, handle: await getHandle() }
  }

  return { getToken, getStatus }
}
