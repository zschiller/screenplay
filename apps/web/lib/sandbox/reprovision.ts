"use server"

import { getModelProviders } from "@/lib/agent/providers"
import {
  buildBrokeredEnv,
  parseHarnessKeys,
  resolveHarnesses,
} from "@/lib/agent/harnesses"
import { redactSensitiveInfo } from "@/lib/agent/redact"
import { getGitHubToken } from "@/lib/auth-helpers"
import { sandboxProvider } from "@/lib/sandbox"
import { configureAgentGit } from "@/lib/sandbox/git"
import { buildNetworkPolicy } from "@/lib/sandbox/network-policy"
import { installHarnesses } from "@/lib/sandbox/provision"
import {
  PROXY_PORT_OFFSET,
  SANDBOX_TIMEOUT,
  SANDBOX_VCPUS,
  SNAPSHOT_EXPIRATION,
  TERMINAL_PORT,
  launchDevAndProxy,
  runLogged,
} from "@/lib/sandbox/provision-internals"
import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { RepoData } from "@/lib/types"

/**
 * Provision a fresh sandbox straight from git: clone the repo into a new VM,
 * run the setup script (alongside the best-effort Claude Code install),
 * configure the agent's git identity + remote, and launch the dev server and
 * bridge proxy. Returns the provisioned, running sandbox's name and preview
 * domain.
 *
 * This is the no-snapshot ("reclone fresh") path, owned as a single unit so it
 * can be reused both by `restartSandbox` (when no snapshot was captured) and by
 * the hibernation fallback (a non-hibernating provider degrades to exactly this
 * path).
 *
 * Like `cloneSandbox`, it *creates* the VM rather than resolving an existing
 * one, so it can't ride the `get`-based runner — it builds the uniform result
 * contract itself and redacts the error on the failure path (a clone or
 * provider failure can spill the GitHub token baked into the source URL). The
 * internal setup/git failures throw so the single catch redacts them uniformly.
 *
 * `ghToken` falls back to the session's GitHub token when omitted; `env` is the
 * persisted repo env to merge into the VM (the caller resolves it).
 */
export async function reprovisionFromGit(
  sandboxName: string,
  repo: RepoData,
  branch: string,
  ghToken?: string,
  env?: Record<string, string> | null,
): Promise<SandboxActionResult<{ sandboxName: string; previewDomain: string }>> {
  try {
    if (!ghToken) ghToken = (await getGitHubToken()) ?? undefined
    const port = repo.devServerPort

    const providers = getModelProviders()
    const networkPolicy = buildNetworkPolicy(providers)
    const harnessKeys = parseHarnessKeys(process.env.SANDBOX_HARNESSES)
    const { installable } = resolveHarnesses(harnessKeys, providers)
    const mergedEnv = { ...buildBrokeredEnv(installable), ...(env ?? {}) }
    const sandbox = await sandboxProvider.create({
      name: sandboxName,
      source: ghToken
        ? { type: "git", url: repo.cloneUrl, revision: branch, username: "x-access-token", password: ghToken }
        : { type: "git", url: repo.cloneUrl, revision: branch },
      ports: [port, port + PROXY_PORT_OFFSET, TERMINAL_PORT],
      timeout: SANDBOX_TIMEOUT,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
      resources: { vcpus: SANDBOX_VCPUS },
      env: mergedEnv,
      networkPolicy,
    })

    // Fresh provision. Mirror the create pipeline: deps + harness install in
    // parallel, then git setup, then dev launch. The harness install is
    // best-effort — the create route ignores its result, and so do we.
    const setup = repo.setupScript?.trim() || "npm install"
    const [setupCmd, ...setupArgs] = setup.split(/\s+/)
    const [setupResult] = await Promise.all([
      runLogged(sandbox, setupCmd, setupArgs),
      installHarnesses(sandbox.name, harnessKeys),
    ])
    if (setupResult.exitCode !== 0) {
      throw new Error(`Setup script failed (exit ${setupResult.exitCode})`)
    }

    const gitResult = await configureAgentGit(sandbox.name, repo, branch)
    if (!gitResult.success) {
      throw new Error(gitResult.error ?? "Failed to configure git")
    }

    const previewDomain = await launchDevAndProxy(sandbox, port, repo.devScript, env)
    return { success: true, value: { sandboxName: sandbox.name, previewDomain } }
  } catch (e) {
    return { success: false, error: redactSensitiveInfo(e instanceof Error ? e.message : String(e)) }
  }
}
