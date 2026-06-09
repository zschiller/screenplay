import "server-only"

import { getVercelSandboxProvider } from "@/lib/sandbox/vercel"
import { getWorktreeSandboxProvider } from "@/lib/sandbox/worktree"
import type { SandboxProvider } from "@/lib/sandbox/types"

export { isSandboxRunning, supportsHibernation } from "@/lib/sandbox/types"
export type {
  HibernatingSandbox,
  SandboxCommandResult,
  SandboxCreateOptions,
  SandboxFile,
  SandboxGetOptions,
  SandboxGitSource,
  SandboxInstance,
  SandboxNetworkPolicy,
  SandboxNetworkPolicyRule,
  SandboxProvider,
  SandboxRunCommandOptions,
  SandboxSnapshotSource,
  SandboxSource,
} from "@/lib/sandbox/types"

/**
 * The configured sandbox provider singleton, selected at build time by the
 * sandbox backend the build targets. The hosted build leaves this as Vercel
 * Sandbox (the default); the desktop build sets `SANDBOX_BACKEND=worktree` to
 * back each Branch's Sandbox with a local git worktree instead of a remote VM.
 *
 * This is the env-switched factory ADR 0003 deferred until a real second
 * provider existed — that provider (the worktree backend) has now landed, so the
 * switch is paid for rather than speculative. Selection is a single read at
 * module load, not a per-call branch.
 */
function selectSandboxProvider(): SandboxProvider {
  switch (process.env.SANDBOX_BACKEND) {
    case "worktree":
      return getWorktreeSandboxProvider()
    case "vercel":
    case undefined:
    case "":
      return getVercelSandboxProvider()
    default:
      throw new Error(
        `Unknown SANDBOX_BACKEND "${process.env.SANDBOX_BACKEND}" ` +
          `(expected "vercel" or "worktree")`
      )
  }
}

export const sandboxProvider: SandboxProvider = selectSandboxProvider()
