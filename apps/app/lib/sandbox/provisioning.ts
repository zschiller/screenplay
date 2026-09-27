import "server-only"

import { getModelProviders } from "@/lib/agent/providers"
import {
  buildBrokeredEnv,
  parseHarnessKeys,
  selectHarnesses,
} from "@/lib/agent/harnesses"
import { redactSensitiveInfo } from "@/lib/agent/redact"
import { storeEnvVars } from "@/lib/env-store"
import { parseCopyPatterns, parseEnvVars } from "@/lib/env-utils"
import { sandboxProvider, usesHostGitAuth } from "@/lib/sandbox"
import type { SandboxSource } from "@/lib/sandbox"
import { configureAgentGit, createAgentBranch } from "@/lib/sandbox/git"
import { buildNetworkPolicy } from "@/lib/sandbox/network-policy"
import {
  installDependencies,
  installHarnesses,
  installRipgrep,
  startDevServer,
} from "@/lib/sandbox/provision"
import {
  PROXY_PORT_OFFSET,
  SANDBOX_TIMEOUT,
  SANDBOX_VCPUS,
  SNAPSHOT_EXPIRATION,
  TERMINAL_PORT,
} from "@/lib/sandbox/provision-internals"
import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { RepoData } from "@/lib/types"

/**
 * How a Branch's git branch comes to exist before its Sandbox is provisioned:
 *
 *  - `new` — a fresh branch off the Repo's default branch.
 *  - `from-branch` — the branch already exists; provision straight onto it.
 *  - `duplicate` — a fresh branch forked from `sourceBranch`.
 */
export type ProvisionMode = "new" | "from-branch" | "duplicate"

export interface ProvisionRequest {
  mode: ProvisionMode
  repo: RepoData
  /** The Branch's git branch name. */
  branch: string
  /** The name to create the Sandbox under. */
  sandboxName: string
  /** The branch to fork from. Required for `duplicate`, ignored otherwise. */
  sourceBranch?: string
  /**
   * The acting user's GitHub token. Only the hosted backend needs it (API
   * branch creation, token-authed clone); where the host owns git auth it's
   * never used.
   */
  ghToken?: string
  /** Progress reporting — one human-readable message per step as it starts. */
  onStatus?: (message: string) => Promise<void> | void
}

export type ProvisionResult = SandboxActionResult<{
  sandboxName: string
  previewDomain: string
}>

/**
 * Provision a Branch's Sandbox end to end: make sure its git branch exists,
 * create the Sandbox from the right source, run the Repo's setup alongside the
 * harness + ripgrep installs, launch the dev server, and configure git. Returns
 * the running Sandbox's name and preview domain, or the first load-bearing
 * step's (redacted) failure. The harness and ripgrep installs are best-effort
 * and never fail provisioning.
 *
 * **Every "local vs hosted" decision here asks one question —
 * {@link usesHostGitAuth}** (keyed to the `SANDBOX_BACKEND` build-time switch,
 * ADR 0007). When the host owns git auth (the local backend):
 *
 *  - the branch is never created through the GitHub API. Local Branches are
 *    worktree branches pushed only on demand, so a source branch may not exist
 *    on GitHub at all; instead the local backend creates the branch at
 *    provision time from the `baseRevision` passed in the source (see
 *    `resolveStartPoint` in the local provider).
 *  - a Repo added from a local folder is provisioned as a worktree of that
 *    checkout (`local-git`, ADR 0009) rather than cloned from its URL.
 *  - no token is ever baked into a clone URL — host credentials cover it.
 *
 * On the hosted backend the branch is created via the GitHub API first and the
 * clone is token-authed.
 */
export async function provisionSandbox(
  req: ProvisionRequest
): Promise<ProvisionResult> {
  const { mode, repo, branch, sandboxName, ghToken } = req
  const report = async (message: string) => {
    await req.onStatus?.(message)
  }

  // Step 1: make sure the git branch exists (or say where to create it from).
  let baseRevision: string | undefined
  if (mode === "new") {
    if (usesHostGitAuth) {
      baseRevision = repo.defaultBranch
    } else {
      const created = await createAgentBranch(repo, branch, undefined, ghToken)
      if (!created.success) {
        return {
          success: false,
          error: created.error || "Failed to create branch",
        }
      }
    }
  } else if (mode === "duplicate") {
    const { sourceBranch } = req
    if (!sourceBranch) {
      return { success: false, error: "Source branch not specified" }
    }
    if (!usesHostGitAuth) {
      const created = await createAgentBranch(
        repo,
        branch,
        sourceBranch,
        ghToken
      )
      if (!created.success) {
        return {
          success: false,
          error: created.error || "Failed to create branch",
        }
      }
    }
    baseRevision = sourceBranch
  }

  console.warn(
    `[provision] start mode=${mode} branch=${branch} ` +
      `sandbox=${sandboxName} hostGitAuth=${usesHostGitAuth} ` +
      `localPath=${JSON.stringify(repo.localPath)} ` +
      `setupScript=${JSON.stringify(repo.setupScript)}`
  )

  // Step 2: create the Sandbox from its source.
  await report("Cloning repository…")
  const created = await createSandbox(
    sandboxName,
    repo,
    resolveSource(repo, branch, ghToken, baseRevision)
  )
  if (!created.success) return created
  const name = created.value

  // Step 3: setup + the selected harnesses + ripgrep in parallel. Only setup is
  // load-bearing: `installHarnesses` logs and swallows a failed CLI, and
  // ripgrep's result is ignored. Harness keys come from SANDBOX_HARNESSES.
  await report("Installing dependencies…")
  const [setup] = await Promise.all([
    installDependencies(name, repo.setupScript),
    installHarnesses(name, parseHarnessKeys(process.env.SANDBOX_HARNESSES)),
    installRipgrep(name),
  ])
  if (!setup.success) return setup

  // Step 4: dev server + bridge proxy.
  await report("Starting dev server…")
  const server = await startDevServer(name, repo.devServerPort, repo.devScript)
  if (!server.success) return server

  // Step 5: git identity / remote / upstream.
  await report("Configuring git…")
  const git = await configureAgentGit(name, repo, branch)
  if (!git.success) return git

  return {
    success: true,
    value: { sandboxName: name, previewDomain: server.value.previewDomain },
  }
}

/**
 * Where the Sandbox's checkout comes from:
 *
 *  - **local-git** — the host owns git and the Repo was added from a local
 *    folder: a worktree of the user's existing checkout.
 *  - **token-git** — hosted, with a token: a clone with the token spliced in.
 *  - **host-git** — otherwise: a plain clone of the URL (host credentials on
 *    the local backend; a public repo on the hosted one).
 *
 * `baseRevision` is the ref to create `branch` from when it doesn't exist yet;
 * the token-git path never needs it, since there the API created the branch.
 */
function resolveSource(
  repo: RepoData,
  branch: string,
  ghToken: string | undefined,
  baseRevision: string | undefined
): SandboxSource {
  if (usesHostGitAuth && repo.localPath) {
    return {
      type: "local-git",
      path: repo.localPath,
      revision: branch,
      baseRevision,
      copyPatterns: parseCopyPatterns(repo.copyPatterns),
    }
  }
  if (!usesHostGitAuth && ghToken) {
    return {
      type: "git",
      url: repo.cloneUrl,
      revision: branch,
      username: "x-access-token",
      password: ghToken,
    }
  }
  return { type: "git", url: repo.cloneUrl, revision: branch, baseRevision }
}

/**
 * Create the Sandbox with the Repo's env (plus the brokered harness gate vars)
 * and network policy, and persist the Repo's env vars against it. A creation
 * failure comes back redacted — it can spill the token baked into a source URL.
 */
async function createSandbox(
  sandboxName: string,
  repo: RepoData,
  source: SandboxSource
): Promise<SandboxActionResult<string>> {
  try {
    const env = parseEnvVars(repo.envVars)
    const providers = getModelProviders()
    // The brokered gate vars (ANTHROPIC_API_KEY=brokered, …) are derived from
    // the harnesses the operator selected via SANDBOX_HARNESSES. No real key is
    // emitted — the firewall injects it on egress.
    const { installable } = selectHarnesses(
      process.env.SANDBOX_HARNESSES,
      providers
    )
    const port = repo.devServerPort
    const sandbox = await sandboxProvider.create({
      name: sandboxName,
      source,
      ports: [port, port + PROXY_PORT_OFFSET, TERMINAL_PORT],
      timeout: SANDBOX_TIMEOUT,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
      resources: { vcpus: SANDBOX_VCPUS },
      env: { ...buildBrokeredEnv(installable), ...env },
      networkPolicy: buildNetworkPolicy(providers),
    })

    if (Object.keys(env).length > 0) {
      await storeEnvVars(sandbox.name, env)
    }

    return { success: true, value: sandbox.name }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { success: false, error: redactSensitiveInfo(message) }
  }
}
