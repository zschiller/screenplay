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
  STREAM_PORT,
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
 *  - `recreate` — the branch already exists *and so does the Sandbox*: the
 *    existing one is discarded and a fresh Sandbox provisioned under the same
 *    name (the destructive "Recreate from scratch" path, and automatic Branch
 *    recovery from a fully-expired snapshot). The branch step is the
 *    `from-branch` no-op — it's the Sandbox, not the branch, that's being
 *    rebuilt — so the only thing this mode adds is freeing the old Sandbox
 *    first. See {@link recreateSandbox}.
 */
export type ProvisionMode = "new" | "from-branch" | "duplicate" | "recreate"

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
   * Re-running a failed create. Frees any Sandbox the failed attempt left under
   * `sandboxName` first, and takes a git branch that already exists (the failed
   * attempt created it) as created. Ignored for `recreate`, which does the
   * former anyway and never creates a branch.
   */
  retry?: boolean
  /**
   * The acting user's GitHub token. Only the hosted backend needs it (API
   * branch creation, token-authed clone); where the host owns git auth it's
   * never used.
   */
  ghToken?: string
  /**
   * The Repo's env var values as `KEY=value` text. They live encrypted per
   * Canvas + Repo, not on the Repo record (#1416), so the caller reads them
   * (`loadCanvasRepoEnv`) and hands them in. Absent = none.
   */
  envVars?: string
  /** Progress reporting — one human-readable message per step as it starts. */
  onStatus?: (message: string) => Promise<void> | void
  /**
   * The checkout is there and git is configured: the agent can start while
   * the dependency install and the dev server, which come next, finish.
   */
  onCodeReady?: (sandboxName: string) => Promise<void> | void
}

export type ProvisionResult = SandboxActionResult<{
  sandboxName: string
  previewDomain: string
}>

/**
 * Provision a Branch's Sandbox end to end: make sure its git branch exists,
 * create the Sandbox from the right source, configure git (then `onCodeReady`:
 * the agent can start), run the Repo's setup alongside the harness + ripgrep
 * installs, and launch the dev server. Returns
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
 *
 * `recreate` differs only in what it starts by tearing down (the existing
 * Sandbox); every step after that is the same code, which is the point — the
 * separate "reprovision from git" pipeline this replaced had drifted away from
 * create on the clone source, the setup shell, env vars, ripgrep and harness
 * selection.
 */
export async function provisionSandbox(
  req: ProvisionRequest
): Promise<ProvisionResult> {
  const { mode, repo, branch, sandboxName, ghToken } = req
  const report = async (message: string) => {
    await req.onStatus?.(message)
  }

  // Step 0 (recreate only): free the name so the fresh Sandbox can claim it.
  // Best-effort — the old Sandbox may be gone (a fully-expired snapshot) or
  // wedged, and neither should block a recreate. This is the *destructive* step
  // of the destructive path: the old checkout, uncommitted changes included, is
  // discarded (ADR 0005 — which is why only the explicitly-confirmed Recreate
  // and snapshot-less recovery ever ask for this mode).
  if (mode === "recreate" || req.retry) {
    try {
      const old = await sandboxProvider.get({
        name: sandboxName,
        resume: false,
      })
      await old.delete()
    } catch {}
  }

  // A retry's first attempt may have created the branch before failing, and
  // that's the branch we want.
  const branchReady = (created: SandboxActionResult<void>) =>
    created.success ||
    (req.retry === true && /already exists/i.test(created.error ?? ""))

  // Step 1: make sure the git branch exists (or say where to create it from).
  // `from-branch` and `recreate` both provision onto a branch that already
  // exists, so neither creates one — and neither needs a base revision.
  let baseRevision: string | undefined
  if (mode === "new") {
    if (usesHostGitAuth) {
      baseRevision = repo.defaultBranch
    } else {
      const created = await createAgentBranch(repo, branch, undefined, ghToken)
      if (!branchReady(created)) {
        return {
          success: false,
          error:
            (!created.success && created.error) || "Couldn’t set up the code.",
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
      if (!branchReady(created)) {
        return {
          success: false,
          error:
            (!created.success && created.error) || "Couldn’t set up the code.",
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
  const env = parseEnvVars(req.envVars ?? "")
  const created = await createSandbox(
    sandboxName,
    repo,
    resolveSource(repo, branch, ghToken, baseRevision),
    env
  )
  if (!created.success) return created
  const name = created.value

  // Step 3: git identity / remote / upstream. It needs only the checkout, so
  // it runs before the slow steps: from here the agent can work on the code.
  await report("Configuring git…")
  const git = await configureAgentGit(name, repo, branch)
  if (!git.success) return git
  await req.onCodeReady?.(name)

  // Step 4: setup + the selected harnesses + ripgrep in parallel. Only setup is
  // load-bearing: `installHarnesses` logs and swallows a failed CLI, and
  // ripgrep's result is ignored. Harness keys come from SANDBOX_HARNESSES.
  await report("Installing dependencies…")
  const [setup] = await Promise.all([
    installDependencies(name, repo.setupScript),
    installHarnesses(name, parseHarnessKeys(process.env.SANDBOX_HARNESSES)),
    installRipgrep(name),
  ])
  if (!setup.success) return setup

  // Step 5: dev server + bridge proxy.
  await report("Starting preview…")
  const server = await startDevServer(
    name,
    repo.devServerPort,
    repo.devScript,
    env
  )
  if (!server.success) return server

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
 * and network policy, and persist the Repo's env vars against it — the
 * persisted copy is what the later restart / reconnect / dev-server-bounce
 * paths re-inject. A creation failure comes back redacted — it can spill the
 * token baked into a source URL.
 */
async function createSandbox(
  sandboxName: string,
  repo: RepoData,
  source: SandboxSource,
  env: Record<string, string>
): Promise<SandboxActionResult<string>> {
  try {
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
      ports: [port, port + PROXY_PORT_OFFSET, TERMINAL_PORT, STREAM_PORT],
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
