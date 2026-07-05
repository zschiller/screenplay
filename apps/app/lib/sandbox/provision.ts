"use server"

import { getModelProviders } from "@/lib/agent/providers"
import {
  buildBrokeredEnv,
  resolveHarnesses,
  selectHarnesses,
  type Harness,
} from "@/lib/agent/harnesses"
import { redactSensitiveInfo } from "@/lib/agent/redact"
import { getGitHubToken } from "@/lib/auth-helpers"
import { storeEnvVars } from "@/lib/env-store"
import { sandboxProvider, usesHostGitAuth } from "@/lib/sandbox"
import { isLocalSandboxBackend } from "@/lib/sandbox/backend"
import type { SandboxInstance } from "@/lib/sandbox/types"
import { buildNetworkPolicy } from "@/lib/sandbox/network-policy"
import {
  PROXY_PORT_OFFSET,
  SANDBOX_TIMEOUT,
  SANDBOX_VCPUS,
  SNAPSHOT_EXPIRATION,
  TERMINAL_PORT,
  launchDevAndProxy,
  runLogged,
  sandboxLogPath,
  writeBridgeFiles,
} from "@/lib/sandbox/provision-internals"
import { runSandboxAction, SandboxStepError } from "@/lib/sandbox/run"
import type { SandboxActionResult } from "@/lib/sandbox/run"

/**
 * How the repo reaches the sandbox beyond the clone URL (PRD #428, local build
 * only): `localPath` routes the local backend at the user's existing clone
 * instead of cloning the URL; `baseRevision` is the ref to create `branch`
 * from when it doesn't exist yet (the no-GitHub-API path, where no one created
 * the branch remotely first).
 */
export interface CloneSourceOptions {
  localPath?: string
  baseRevision?: string
  /**
   * Glob patterns of files (e.g. `.env*`) the local backend copies from the
   * original checkout into the new worktree — the desktop-mode replacement
   * for spelling env vars out in repo settings. Only meaningful alongside
   * `localPath`; the hosted path has no original checkout to copy from.
   */
  copyPatterns?: string[]
}

/**
 * Clone a repo into a new sandbox. Unlike the other provision actions this one
 * *creates* the VM rather than resolving an existing one, so it can't ride the
 * `get`-based runner — it builds the uniform result contract itself and redacts
 * the error on the failure path (a clone failure can spill the GitHub token
 * baked into the source URL).
 */
export async function cloneSandbox(
  sandboxName: string,
  gitUrl: string,
  branch: string,
  port: number = 3000,
  env?: Record<string, string>,
  ghToken?: string,
  sourceOpts?: CloneSourceOptions
): Promise<SandboxActionResult<{ sandboxName: string }>> {
  try {
    if (!ghToken) ghToken = (await getGitHubToken()) ?? undefined

    const providers = getModelProviders()
    const networkPolicy = buildNetworkPolicy(providers)
    // The brokered gate vars (ANTHROPIC_API_KEY=brokered, …) are derived from
    // the harnesses the operator selected via SANDBOX_HARNESSES, beside the
    // network policy. No real key is emitted — the firewall injects it on egress.
    const installable = selectHarnesses(
      process.env.SANDBOX_HARNESSES,
      providers
    ).installable
    const mergedEnv = { ...buildBrokeredEnv(installable), ...(env ?? {}) }

    const sandbox = await sandboxProvider.create({
      name: sandboxName,
      // The local backend clones as a host process through the user's
      // own git credentials, so never bake a brokered token into its clone URL —
      // host auth covers private repos. Only the hosted path splices the token
      // in. A Repo added from a local folder (PRD #428) skips cloning entirely:
      // the local backend roots at the existing clone.
      source:
        usesHostGitAuth && sourceOpts?.localPath
          ? {
              type: "local-git",
              path: sourceOpts.localPath,
              revision: branch,
              baseRevision: sourceOpts?.baseRevision,
              copyPatterns: sourceOpts?.copyPatterns,
            }
          : !usesHostGitAuth && ghToken
            ? {
                type: "git",
                url: gitUrl,
                revision: branch,
                username: "x-access-token",
                password: ghToken,
              }
            : {
                type: "git",
                url: gitUrl,
                revision: branch,
                baseRevision: sourceOpts?.baseRevision,
              },
      ports: [port, port + PROXY_PORT_OFFSET, TERMINAL_PORT],
      timeout: SANDBOX_TIMEOUT,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
      resources: { vcpus: SANDBOX_VCPUS },
      env: mergedEnv,
      networkPolicy,
    })

    if (env && Object.keys(env).length > 0) {
      await storeEnvVars(sandbox.name, env)
    }

    return { success: true, value: { sandboxName: sandbox.name } }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { success: false, error: redactSensitiveInfo(message) }
  }
}

/**
 * Write the in-sandbox HTML-injecting proxy and DOM bridge script into the
 * sandbox. Idempotent — safe to call on every dev-server start. Returns the
 * uniform result contract; a failed write comes back redacted via the runner.
 */
export async function installBridge(
  sandboxName: string
): Promise<SandboxActionResult<void>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    await writeBridgeFiles(sandbox)
  })
}

/**
 * Run the setup script (e.g. `npm install`) in an existing sandbox. The script
 * is tee'd to the shared sandbox log so the Logs panel can show install
 * progress. Returns the uniform result contract.
 */
export async function installDependencies(
  sandboxName: string,
  setupScript?: string
): Promise<SandboxActionResult<void>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    const setup = setupScript?.trim() || "npm install"

    // Desktop (local) backend: run the setup script through the user's
    // interactive login shell instead of bare-spawning the command. A bare
    // spawn resolves `pnpm`/`node`/etc. against the sidecar's curated PATH,
    // which does NOT match the user's terminal — version-manager shims
    // (corepack/nvm/asdf) and PATH edits live in the interactive rc file
    // (`.zshrc`), so the bare command can resolve a different or missing binary
    // than the user gets by hand. (Concretely: it picked a stale pnpm that
    // rejected a pnpm-10 workspace file even though `pnpm install` worked in the
    // terminal.) `$SHELL -ilc` reproduces the terminal exactly — same HOME, same
    // rc, same corepack cache — and as a bonus honors shell operators like
    // `cd app && pnpm install`. `sidecar.rs` already uses `-ilc` to recover the
    // login PATH, so this mirrors that. The hosted backend has no user shell, so
    // it keeps the plain argv split.
    let setupCmd: string
    let setupArgs: string[]
    if (isLocalSandboxBackend()) {
      setupCmd = process.env.SHELL || "/bin/zsh"
      setupArgs = ["-ilc", setup]
    } else {
      const parts = setup.split(/\s+/)
      setupCmd = parts[0]
      setupArgs = parts.slice(1)
    }
    console.warn(
      `[setup] running "${setup}" on ${sandboxName} ` +
        `via ${setupCmd} ${JSON.stringify(setupArgs)}`
    )
    const res = await runLogged(sandbox, setupCmd, setupArgs)

    if (res.exitCode === 0) {
      console.warn(`[setup] "${setup}" on ${sandboxName} ok`)
      return
    }

    // A failing setup script must fail the branch, not silently leave a
    // dependency-less worktree whose dev server then dies on `command not
    // found`. (Previously the log wrapper's exit masked this — see runLogged.)
    // `runLogged` tees output to the sandbox log, so read it back *now* — before
    // `launchDevAndProxy` truncates it at dev-server start — to surface the real
    // error on the console and in the branch's error state.
    let logTail = ""
    try {
      const buf = await sandbox.readFileToBuffer({
        path: sandboxLogPath(sandbox.name),
      })
      logTail = buf ? buf.toString("utf8").slice(-3000) : ""
    } catch {
      // best-effort: the log read must never mask the real setup failure
    }
    console.warn(
      `[setup] "${setup}" on ${sandboxName} FAILED exit=${res.exitCode}\n` +
        `--- setup log tail ---\n${logTail}\n--- end setup log ---`
    )
    throw new SandboxStepError(setup, res.exitCode, logTail.slice(-500))
  })
}

/**
 * Best-effort install of ripgrep so the agent's `grep` tool runs `rg` (fast,
 * .gitignore-aware) instead of its portable `grep -rn` fallback. Tries the
 * package managers across our base images (dnf/yum on Amazon Linux, apt on
 * Debian); the `|| true` makes a box with no matching manager (or no network)
 * still succeed.
 *
 * Deliberately never throws: ripgrep is an optimization, not a requirement —
 * the `grep` tool already falls back to plain `grep` when `rg` is absent — so a
 * failed install must not fail provisioning. Idempotent (no-ops when rg is
 * already present), so it's safe to run on every provision.
 */
export async function installRipgrep(
  sandboxName: string
): Promise<SandboxActionResult<void>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        "command -v rg >/dev/null 2>&1 || dnf install -y ripgrep || " +
          "yum install -y ripgrep || (apt-get update && apt-get install -y ripgrep) || true",
      ],
      sudo: true,
    })
  })
}

/**
 * Install one harness: a global `npm install -g <package>` followed by the
 * descriptor's `seed()`. A non-zero exit throws (with redacted stderr) the same
 * `SandboxStepError` the runner uses; `installHarnesses` catches it per-harness
 * so a single bad CLI is logged and swallowed rather than failing the install.
 * The seed writes that follow are fire-and-forget.
 */
async function installOneHarness(
  sandbox: SandboxInstance,
  harness: Harness
): Promise<void> {
  // `step` can't express `sudo`, so run the global install directly and turn a
  // non-zero exit into the same redacted SandboxStepError the runner maps to a
  // failure result.
  const install = await sandbox.runCommand({
    cmd: "npm",
    args: ["install", "-g", harness.installPackage],
    sudo: true,
  })
  if (install.exitCode !== 0) {
    const stderr = redactSensitiveInfo(await install.stderr()).slice(0, 500)
    throw new SandboxStepError(
      `npm install -g ${harness.installPackage}`,
      install.exitCode,
      stderr
    )
  }

  await harness.seed(sandbox)
}

/**
 * Install the operator-selected harnesses into a sandbox: a best-effort,
 * parallel fold over the installable descriptors resolved from `harnessKeys`
 * against the live provider registry. For each, run a global `npm install -g`
 * then the descriptor's `seed()`. Replaces `installClaudeCode`.
 *
 * Every operator-facing edge of a partial/empty config explains itself in the
 * logs instead of silently producing a broken or bare Sandbox:
 *
 *  - A *skipped* harness — an unknown/typo'd key, or one whose broker provider is
 *    unconfigured or non-brokerable (e.g. Gemini, whose `egress()` is null) — is
 *    dropped by the selection fold with a log line, never a hard failure.
 *  - A *failed* install is logged (redacted) and swallowed per-harness, so one
 *    bad CLI can't dark the whole Sandbox: the others still install and the
 *    action stays successful. "Best-effort" is the contract here, not just a
 *    caller policy.
 *
 * With no installable harnesses (unset `SANDBOX_HARNESSES`, or none brokerable)
 * this is a no-op success.
 */
export async function installHarnesses(
  sandboxName: string,
  harnessKeys: string[]
): Promise<SandboxActionResult<void>> {
  // The desktop (local) backend has no per-sandbox install step: harnesses ride
  // the host's own installed CLI (resolved via `hostBinary` on the host PATH —
  // see `host-binary.ts`), and the login lives on the host. Running the hosted
  // `npm install -g <harness>` here is not just pointless but harmful: it tries
  // to write the host's global prefix (e.g. `/usr/local/lib/node_modules`),
  // fails EACCES, and spams the sandbox log on every worktree create. Skip it.
  if (isLocalSandboxBackend()) {
    return { success: true, value: undefined }
  }
  return runSandboxAction(sandboxName, async (sandbox) => {
    const { installable, skipped } = resolveHarnesses(
      harnessKeys,
      getModelProviders()
    )
    for (const { key, reason } of skipped) {
      console.warn(`[harness] skipped "${key}": ${reason}`)
    }
    await Promise.all(
      installable.map(async (harness) => {
        try {
          await installOneHarness(sandbox, harness)
        } catch (e) {
          const message = redactSensitiveInfo(
            e instanceof Error ? e.message : String(e)
          )
          console.warn(
            `[harness] install failed for "${harness.key}": ${message}`
          )
        }
      })
    )
  })
}

/**
 * Launch the user's dev server and the bridge proxy in an existing sandbox.
 * The returned `previewDomain` points at the proxy port (devserver port +
 * offset), which injects the DOM bridge. Collapses the legacy `SandboxResult`
 * into the uniform contract — success/failure is the discriminant, so the old
 * `status` field is gone.
 */
export async function startDevServer(
  sandboxName: string,
  port: number = 3000,
  devScript?: string
): Promise<
  SandboxActionResult<{ sandboxName: string; previewDomain: string }>
> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    const previewDomain = await launchDevAndProxy(sandbox, port, devScript)
    return { sandboxName: sandbox.name, previewDomain }
  })
}

/**
 * The DOM-bridge script version the server expects an iframe to report. A pure
 * query — returns a plain value, not the command-result contract — so the
 * client can compare it against what a running sandbox actually served.
 */
export async function getBridgeVersion(): Promise<string> {
  const { BRIDGE_VERSION } = await import("@/lib/sandbox-bridge")
  return BRIDGE_VERSION
}
