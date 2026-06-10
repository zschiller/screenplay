import "server-only"

import { isLocalSandboxBackend } from "@/lib/sandbox/backend"
import { getVercelSandboxProvider } from "@/lib/sandbox/vercel"
import { getLocalSandboxProvider } from "@/lib/sandbox/local/provider"
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
 * Sandbox (the default); the desktop build sets `SANDBOX_BACKEND=local` to back
 * each Branch's Sandbox with a git worktree on the host instead of a remote VM
 * ("worktree", the mechanism name, keeps selecting the same backend — see
 * `lib/sandbox/backend.ts`).
 *
 * This is the env-switched factory ADR 0003 deferred until a real second
 * provider existed — that provider (the local backend) has now landed, so the
 * switch is paid for rather than speculative. Selection is a single read at
 * module load, not a per-call branch.
 */
function selectSandboxProvider(): SandboxProvider {
  if (isLocalSandboxBackend()) return getLocalSandboxProvider()
  const backend = process.env.SANDBOX_BACKEND
  if (backend === "vercel" || backend === undefined || backend === "") {
    return getVercelSandboxProvider()
  }
  throw new Error(
    `Unknown SANDBOX_BACKEND "${backend}" (expected "vercel" or "local")`
  )
}

export const sandboxProvider: SandboxProvider = selectSandboxProvider()

/**
 * Whether git operations authenticate through the **host's own credentials**
 * (credential helper / SSH / `gh`) instead of a brokered, per-`runCommand`
 * `SCREENPLAY_GH_TOKEN`. True only for the local backend: there git runs as a
 * host process in the Sandbox's worktree, so it already inherits the user's git
 * config and credentials, and ADR 0002's firewall trust boundary — the reason
 * the token was brokered per command on the hosted path — doesn't exist on the
 * host. The hosted Vercel backend is unchanged: it keeps brokering the token.
 *
 * Like the provider selection above, this is a single read at module load, not a
 * per-call branch, and it is keyed to the same `SANDBOX_BACKEND` switch.
 */
export const usesHostGitAuth: boolean = isLocalSandboxBackend()
