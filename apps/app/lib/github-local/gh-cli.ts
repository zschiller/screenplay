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
  return {
    async getToken() {
      try {
        const result = await run("gh", ["auth", "token"])
        if (result.exitCode !== 0) return null
        const token = result.stdout.trim()
        return token === "" ? null : token
      } catch {
        return null
      }
    },
  }
}
