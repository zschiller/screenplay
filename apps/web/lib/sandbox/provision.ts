"use server"

import { getModelProviders } from "@/lib/agent/providers"
import { redactSensitiveInfo } from "@/lib/agent/redact"
import { getGitHubToken } from "@/lib/auth-helpers"
import { storeEnvVars } from "@/lib/env-store"
import { sandboxProvider } from "@/lib/sandbox"
import { buildNetworkPolicy } from "@/lib/sandbox/network-policy"
import {
  BROKERED_ANTHROPIC_ENV,
  PROXY_PORT_OFFSET,
  SANDBOX_TIMEOUT,
  SANDBOX_VCPUS,
  SNAPSHOT_EXPIRATION,
  TERMINAL_PORT,
  launchDevAndProxy,
  runLogged,
  writeBridgeFiles,
} from "@/lib/sandbox/provision-internals"
import { runSandboxAction, SandboxStepError } from "@/lib/sandbox/run"
import type { SandboxActionResult } from "@/lib/sandbox/run"

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
): Promise<SandboxActionResult<{ sandboxName: string }>> {
  try {
    if (!ghToken) ghToken = (await getGitHubToken()) ?? undefined

    const networkPolicy = buildNetworkPolicy(getModelProviders())
    const mergedEnv = { ...BROKERED_ANTHROPIC_ENV, ...(env ?? {}) }

    const sandbox = await sandboxProvider.create({
      name: sandboxName,
      source: ghToken
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
  sandboxName: string,
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
  setupScript?: string,
): Promise<SandboxActionResult<void>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    const setup = setupScript?.trim() || "npm install"
    const [setupCmd, ...setupArgs] = setup.split(/\s+/)
    await runLogged(sandbox, setupCmd, setupArgs)
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
  sandboxName: string,
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
 * Install the Claude Code CLI globally so `sandbox ssh <name>` lands in a box
 * where `claude` just works, then pre-seed the onboarding state, a user-level
 * CLAUDE.md, and the per-command git credential helper.
 *
 * The global install is load-bearing: a non-zero exit throws (with redacted
 * stderr) so the action reports failure truthfully. "Best-effort" is a caller
 * policy — the `agent/create` route chooses to ignore this result; the action
 * itself does not swallow the failure. The config writes that follow are
 * fire-and-forget (their exit codes are ignored, matching the prior behavior).
 */
export async function installClaudeCode(
  sandboxName: string,
): Promise<SandboxActionResult<void>> {
  return runSandboxAction(sandboxName, async (sandbox) => {
    // `step` can't express `sudo`, so run the global install directly and turn
    // a non-zero exit into the same redacted SandboxStepError the runner maps
    // to a failure result.
    const install = await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "-g", "@anthropic-ai/claude-code"],
      sudo: true,
    })
    if (install.exitCode !== 0) {
      const stderr = redactSensitiveInfo(await install.stderr()).slice(0, 500)
      throw new SandboxStepError("npm install -g @anthropic-ai/claude-code", install.exitCode, stderr)
    }

    // The checkout location and the writable home are provider-supplied, so the
    // onboarding seed follows the actual sandbox layout instead of a hardcoded
    // backend path. On Vercel these are /vercel/sandbox and /root.
    const { worktreePath, homeDir } = sandbox

    // Pre-seed ~/.claude.json so the user lands in an already-onboarded state:
    // theme set, API-key prompt approved for our "brokered" placeholder, and
    // the checked-out worktree pre-trusted.
    const claudeConfig = JSON.stringify({
      theme: "auto",
      hasCompletedOnboarding: true,
      customApiKeyResponses: { approved: ["brokered"], rejected: [] },
      projects: {
        [worktreePath]: {
          hasTrustDialogAccepted: true,
          projectOnboardingSeenCount: 1,
          allowedTools: [],
          mcpContextUris: [],
          mcpServers: {},
          enabledMcpjsonServers: [],
          disabledMcpjsonServers: [],
        },
      },
    })
    await sandbox.runCommand({
      cmd: "sh",
      args: ["-c", `printf '%s' "$CLAUDE_CONFIG" > "${homeDir}/.claude.json"`],
      env: { CLAUDE_CONFIG: claudeConfig },
    })

    // User-level CLAUDE.md so every session in this sandbox inherits the
    // always-commit-and-push rule. Lives in the home dir (not the cloned repo)
    // so it doesn't pollute the user's git history.
    const claudeMd = [
      "# Screenplay sandbox rules",
      "",
      "## CRITICAL — always commit and push after changes",
      "",
      "After ANY file change, you MUST run these three commands before ending your turn. Never skip. This is the most important rule.",
      "",
      "1. `git add -A`",
      '2. `git commit -m "<concise description of changes>"`',
      "3. `git push`",
      "",
      "If you do not push, the user will not see your changes in the Screenplay UI. Always push.",
      "",
    ].join("\n")
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p "${homeDir}/.claude" && printf '%s' "$CLAUDE_MD" > "${homeDir}/.claude/CLAUDE.md"`,
      ],
      env: { CLAUDE_MD: claudeMd },
    })

    // Per-command credential helper: git invokes it whenever it needs
    // GitHub auth, and it reads SCREENPLAY_GH_TOKEN from the env the server
    // set on the triggering runCommand. No token is persisted in the
    // sandbox — every command brings its own, so two users sharing this
    // sandbox correctly push as themselves rather than riding on whoever
    // provisioned it first.
    const credentialHelper = [
      "#!/bin/sh",
      `[ "\${1:-}" = "get" ] || exit 0`,
      "cat >/dev/null",
      `[ -n "\${SCREENPLAY_GH_TOKEN:-}" ] || exit 0`,
      `printf 'username=x-access-token\\npassword=%s\\n' "$SCREENPLAY_GH_TOKEN"`,
      "",
    ].join("\n")
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p "${homeDir}/.screenplay" && printf '%s' "$HELPER" > "${homeDir}/.screenplay/git-credential-helper.sh" && chmod +x "${homeDir}/.screenplay/git-credential-helper.sh" && git config --global credential.helper "${homeDir}/.screenplay/git-credential-helper.sh" && git config --global credential.useHttpPath false`,
      ],
      env: { HELPER: credentialHelper },
    })
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
  devScript?: string,
): Promise<SandboxActionResult<{ sandboxName: string; previewDomain: string }>> {
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
