import "server-only"

import { backendSwitch } from "@/lib/capabilities"
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
  const backend = backendSwitch("SANDBOX_BACKEND")
  if (backend === "vercel" || backend === undefined || backend === "") {
    return getVercelSandboxProvider()
  }
  throw new Error(
    `Unknown SANDBOX_BACKEND "${backend}" (expected "vercel" or "local")`
  )
}

export const sandboxProvider: SandboxProvider = selectSandboxProvider()

/**
 * Whether each Sandbox is a worktree on this machine rather than a remote VM.
 * A sandbox fact, not a credentials one (who holds git's credentials is
 * `githubAccess.git`, `lib/github-access`): a host Sandbox can be a worktree of
 * a local checkout, and creates its branch at provision time instead of
 * through the GitHub API, because local branches are pushed only on demand.
 *
 * A single read at module load, keyed to the same `SANDBOX_BACKEND` switch as
 * the provider.
 */
export const sandboxIsOnHost: boolean = isLocalSandboxBackend()

/**
 * The server's own address for a preview URL a browser loads (a frame's
 * `previewDomain` plus its route), so the server never fetches a browser URL:
 * on the local backend, a preview's exposed origin maps back to
 * `http://127.0.0.1:<port>`. Anything else, and every URL on the hosted
 * backend (whose previews have one public URL), comes back unchanged.
 */
export async function toInternalPreviewUrl(url: string): Promise<string> {
  return isLocalSandboxBackend()
    ? getLocalSandboxProvider().internalUrlFor(url)
    : url
}
