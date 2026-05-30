"use server"

import { getGitHubTokenForUser, getUserId } from "@/lib/auth-helpers"
import { sandboxProvider } from "@/lib/sandbox"
import type { SandboxInstance, SandboxNetworkPolicy, SandboxSource } from "@/lib/sandbox"
import { configureAgentGit } from "@/lib/sandbox/git"
import { storeEnvVars, getEnvVars, deleteEnvVars } from "./env-store"
import type { WorkspaceData } from "./types"

// 30 minutes — keep sandboxes alive only while actively used.
// sandboxProvider.get with resume:true will reboot the VM when a user returns.
const SANDBOX_TIMEOUT = 30 * 60 * 1000
// 24 hours — snapshots preserve the full filesystem (node_modules etc.)
const SNAPSHOT_EXPIRATION = 24 * 60 * 60 * 1000
// 1 vCPU = 2048 MB memory — sufficient for a Node.js dev server
const SANDBOX_VCPUS = 1

// Brokers Anthropic auth at the firewall: the sandbox never sees the real key.
// The "*": [] rule lets everything else pass through end-to-end unchanged.
// Returns undefined if the server has no key, so sandboxes still boot on
// `allow-all` in that case rather than failing creation.
function buildNetworkPolicy(): SandboxNetworkPolicy | undefined {
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return undefined
  return {
    allow: {
      "api.anthropic.com": [{ transform: [{ headers: { "x-api-key": key } }] }],
      "*": [],
    },
  }
}

// Claude Code gates on ANTHROPIC_API_KEY being set — the value doesn't matter
// since the firewall proxy overrides the header on egress.
const BROKERED_ANTHROPIC_ENV = { ANTHROPIC_API_KEY: "brokered" }

export interface SandboxResult {
  sandboxName: string
  previewDomain: string
  status: "running" | "error"
  error?: string
}

/**
 * Team + project slugs for the sandbox CLI, decoded from the project's OIDC
 * token. Used to build a `sandbox ssh --scope <team> --project <project> <name>`
 * string that resolves from anywhere. Returns {} if the token is missing or
 * malformed — the UI falls back to a bare `sandbox ssh <name>`.
 */
export async function getSandboxCliContext(): Promise<{ scope?: string; project?: string }> {
  const token = process.env.VERCEL_OIDC_TOKEN
  if (!token) return {}
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1] ?? "", "base64url").toString(),
    )
    return {
      scope: typeof payload.owner === "string" ? payload.owner : undefined,
      project: typeof payload.project === "string" ? payload.project : undefined,
    }
  } catch {
    return {}
  }
}

export async function getGitHubToken(): Promise<string | null> {
  const userId = await getUserId()
  if (!userId) return null
  return getGitHubTokenForUser(userId)
}

/**
 * Resolve the user whose GitHub identity should be used for a given sandbox
 * operation. Prefers the live session user on the current request (so each
 * collaborator's git actions are correctly attributed to them). Falls back to
 * the workspace/project owner for non-interactive paths — the owner is the
 * one constant identity tied to the project.
 */
export async function resolveActingUserId(
  fallbackRoomId?: string,
): Promise<string | null> {
  const live = await getUserId()
  if (live) return live
  if (!fallbackRoomId) return null
  const { getRoomOwnerId } = await import("./projects-actions")
  return getRoomOwnerId(fallbackRoomId)
}

import { parseEnvVars } from "./env-utils"

const SANDBOX_LOG_PATH = "/tmp/screenplay/sandbox.log"
// Pidfiles for the dev server and proxy. Both are launched under `setsid` so
// their PID equals their PGID — the stop path uses these to SIGKILL the whole
// process group in one shot, catching every child that a port-based kill
// would otherwise miss (Next compile workers, esbuild, the proxy respawn loop).
const PIDFILE_DEV = "/tmp/screenplay/dev.pid"
const PIDFILE_PROXY = "/tmp/screenplay/proxy.pid"

// Offset between the user's dev port and the bridge proxy's public port.
// Far enough from typical monorepo ports (3001, 4200, 5173, 8080…) that a
// dev script running multiple apps in-sandbox can't collide with the proxy.
const PROXY_PORT_OFFSET = 1000

// Env vars to make install output readable and live-streamable:
// - PNPM_CONFIG_REPORTER=append-only: pnpm prints line-by-line install
//   progress (vs. its default silent/summary mode when not on a TTY)
// - NPM_CONFIG_PROGRESS=false: disables the animated progress bar npm
//   tries to use (which uses carriage returns that look ugly in a log)
// - FORCE_COLOR / CLICOLOR_FORCE / TERM: keep ANSI colors enabled
const LOG_ENV = [
  "FORCE_COLOR=1",
  "CLICOLOR_FORCE=1",
  "TERM=xterm-256color",
  "PNPM_CONFIG_REPORTER=append-only",
  "NPM_CONFIG_PROGRESS=false",
].join(" ")

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`
}

/**
 * Run a command in the sandbox with stdout+stderr tee'd to the shared
 * sandbox log file so the Logs panel can surface the full startup output
 * (npm install, git pull, dev server, etc.). The command's exit code is
 * preserved. Callers that need stdout content should still use
 * `sandbox.runCommand` directly — this helper discards buffered output.
 */
async function runLogged(
  sandbox: SandboxInstance,
  cmd: string,
  args: string[],
  options: { env?: Record<string, string>; label?: string } = {},
) {
  const label = options.label ?? `${cmd}${args.length ? " " + args.join(" ") : ""}`
  const header = shellQuote(`\n$ ${label}\n`)
  const quotedCmd = [cmd, ...args].map(shellQuote).join(" ")
  const sh =
    `mkdir -p /tmp/screenplay; ` +
    `printf %s ${header} >> ${SANDBOX_LOG_PATH} 2>/dev/null; ` +
    `${LOG_ENV} ${quotedCmd} >> ${SANDBOX_LOG_PATH} 2>&1; ` +
    `printf '[exit %s]\\n' $? >> ${SANDBOX_LOG_PATH} 2>/dev/null`
  return sandbox.runCommand({
    cmd: "sh",
    args: ["-c", sh],
    ...(options.env ? { env: options.env } : {}),
  })
}

/**
 * Clone a repo into a new sandbox. Returns the sandbox name on success.
 */
export async function cloneSandbox(
  sandboxName: string,
  gitUrl: string,
  branch: string,
  port: number = 3000,
  env?: Record<string, string>,
  ghToken?: string,
): Promise<{ success: true; sandboxName: string } | { success: false; error: string }> {
  try {
    if (!ghToken) ghToken = await getGitHubToken() ?? undefined

    const networkPolicy = buildNetworkPolicy()
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
      ports: [port, port + PROXY_PORT_OFFSET],
      timeout: SANDBOX_TIMEOUT,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
      resources: { vcpus: SANDBOX_VCPUS },
      env: mergedEnv,
      networkPolicy,
    })

    if (env && Object.keys(env).length > 0) {
      await storeEnvVars(sandbox.name, env)
    }

    return { success: true, sandboxName: sandbox.name }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Run the setup script (e.g. npm install) in an existing sandbox.
 */
export async function installDependencies(
  sandboxName: string,
  setupScript?: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const sandbox = await sandboxProvider.get({ name: sandboxName, resume: false })
    const setup = setupScript?.trim() || "npm install"
    const [setupCmd, ...setupArgs] = setup.split(/\s+/)
    await runLogged(sandbox, setupCmd, setupArgs)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Install the Claude Code CLI globally so `sandbox ssh <name>` lands in a box
 * where `claude` just works. Best-effort — never throws; the dev pipeline
 * should not fail just because the CLI install hiccupped.
 */
export async function installClaudeCode(
  sandboxName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const sandbox = await sandboxProvider.get({ name: sandboxName, resume: false })
    const result = await sandbox.runCommand({
      cmd: "npm",
      args: ["install", "-g", "@anthropic-ai/claude-code"],
      sudo: true,
    })
    if (result.exitCode !== 0) {
      return { success: false, error: (await result.stderr()).slice(0, 500) }
    }

    // Pre-seed ~/.claude.json so the user lands in an already-onboarded state:
    // theme set, API-key prompt approved for our "brokered" placeholder, and
    // /vercel/sandbox pre-trusted.
    const claudeConfig = JSON.stringify({
      theme: "auto",
      hasCompletedOnboarding: true,
      customApiKeyResponses: { approved: ["brokered"], rejected: [] },
      projects: {
        "/vercel/sandbox": {
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
      args: ["-c", `printf '%s' "$CLAUDE_CONFIG" > "$HOME/.claude.json"`],
      env: { CLAUDE_CONFIG: claudeConfig },
    })

    // User-level CLAUDE.md so every session in this sandbox inherits the
    // always-commit-and-push rule. Lives in $HOME (not the cloned repo) so it
    // doesn't pollute the user's git history.
    const claudeMd = [
      "# Screenplay sandbox rules",
      "",
      "## CRITICAL — always commit and push after changes",
      "",
      "After ANY file change, you MUST run these three commands before ending your turn. Never skip. This is the most important rule.",
      "",
      "1. `git add -A`",
      "2. `git commit -m \"<concise description of changes>\"`",
      "3. `git push`",
      "",
      "If you do not push, the user will not see your changes in the Screenplay UI. Always push.",
      "",
    ].join("\n")
    await sandbox.runCommand({
      cmd: "sh",
      args: [
        "-c",
        `mkdir -p "$HOME/.claude" && printf '%s' "$CLAUDE_MD" > "$HOME/.claude/CLAUDE.md"`,
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
        `mkdir -p "$HOME/.screenplay" && printf '%s' "$HELPER" > "$HOME/.screenplay/git-credential-helper.sh" && chmod +x "$HOME/.screenplay/git-credential-helper.sh" && git config --global credential.helper "$HOME/.screenplay/git-credential-helper.sh" && git config --global credential.useHttpPath false`,
      ],
      env: { HELPER: credentialHelper },
    })

    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Write the in-sandbox HTML-injecting proxy and DOM bridge script to
 * /tmp/screenplay/. Idempotent — safe to call on every dev-server start.
 * Uses /tmp because commands run as the `vercel-sandbox` user, which has no
 * read access to /root. The proxy forwards the public port (port +
 * PROXY_PORT_OFFSET) to the user's devserver on `port`, injecting a
 * <script> tag that exposes a postMessage DOM bridge.
 */
export async function installBridge(
  sandboxName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const sandbox = await sandboxProvider.get({ name: sandboxName, resume: false })
    const { PROXY_JS, BRIDGE_JS } = await import("./sandbox-bridge")
    await sandbox.writeFiles([
      { path: "/tmp/screenplay/proxy.mjs", content: PROXY_JS },
      { path: "/tmp/screenplay/bridge.js", content: BRIDGE_JS },
    ])
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function getBridgeVersion(): Promise<string> {
  const { BRIDGE_VERSION } = await import("./sandbox-bridge")
  return BRIDGE_VERSION
}


/**
 * Launch both the user's dev server and the bridge proxy. Installs the bridge
 * files first (idempotent). Returns a SandboxResult pointing at the proxy
 * URL (port + PROXY_PORT_OFFSET) rather than the devserver URL.
 */
async function _launchDevAndProxy(
  sandbox: SandboxInstance,
  port: number,
  devScript?: string,
  env?: Record<string, string> | null,
): Promise<SandboxResult> {
  const install = await installBridge(sandbox.name)
  if (!install.success) {
    return { sandboxName: sandbox.name, previewDomain: "", status: "error", error: install.error }
  }

  const dev = devScript?.trim() || "npm run dev"
  const devHeader = shellQuote(`\n$ ${dev}\n`)
  // Launch the dev server under `setsid` so it becomes the leader of a new
  // session and its PID equals its PGID. We capture that PID — the stop path
  // uses `kill -KILL -<pid>` to take down the whole process group, which is
  // the only reliable way to catch every child the dev server spawns
  // (Next compile workers, esbuild, etc.). `& disown` returns the outer
  // shell immediately while the dev tree keeps running.
  const devInner = shellQuote(
    `export ${LOG_ENV}; exec ${dev} >> ${SANDBOX_LOG_PATH} 2>&1`,
  )
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p /tmp/screenplay; ` +
        `printf %s ${devHeader} >> ${SANDBOX_LOG_PATH} 2>/dev/null; ` +
        `setsid sh -c ${devInner} </dev/null >/dev/null 2>&1 & ` +
        `echo $! > ${PIDFILE_DEV}; ` +
        `disown`,
    ],
    detached: true,
    ...(env ? { env } : {}),
  })

  // Restart-on-crash wrapper so a proxy bug doesn't permanently dark the
  // iframe. Same setsid trick as above so the stop path can take down the
  // wrapper shell and any node child it spawned by killing the group.
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `setsid sh -c 'while true; do node /tmp/screenplay/proxy.mjs; sleep 1; done' </dev/null >/dev/null 2>&1 & ` +
      `echo $! > ${PIDFILE_PROXY}; ` +
      `disown`,
    ],
    detached: true,
    env: {
      SCREENPLAY_UPSTREAM_PORT: String(port),
      SCREENPLAY_LISTEN_PORT: String(port + PROXY_PORT_OFFSET),
    },
  })

  return {
    sandboxName: sandbox.name,
    previewDomain: sandbox.domain(port + PROXY_PORT_OFFSET),
    status: "running",
  }
}

/**
 * Start the dev server in an existing sandbox. Returns the preview domain.
 */
export async function startDevServer(
  sandboxName: string,
  port: number = 3000,
  devScript?: string,
): Promise<SandboxResult> {
  try {
    const sandbox = await sandboxProvider.get({ name: sandboxName, resume: false })
    return await _launchDevAndProxy(sandbox, port, devScript)
  } catch (e) {
    return {
      sandboxName,
      previewDomain: "",
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Check if a sandbox preview URL is responding with real content.
 * The sandbox proxy may return 200 with an empty/placeholder page before
 * the dev server is actually listening, so we verify the body has content.
 */
export async function probeSandboxUrl(
  url: string,
): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "text/html" },
    })
    if (!res.ok) return false
    const body = await res.text()
    // A real dev server response will contain HTML markup.
    // Proxy placeholders / blank pages won't have a <body> or <div> tag.
    return body.includes("<body") || body.includes("<div")
  } catch {
    return false
  }
}

export async function reconnectSandbox(
  sandboxName: string,
  port: number = 3000,
  devScript?: string,
): Promise<SandboxResult> {
  try {
    // First check current status without resuming
    const check = await sandboxProvider.get({ name: sandboxName, resume: false })
    if (check.status === "running") {
      return {
        sandboxName: check.name,
        previewDomain: check.domain(port + PROXY_PORT_OFFSET),
        status: "running",
      }
    }

    // Sandbox timed out — resume it and restart the dev server
    const sandbox = await sandboxProvider.get({ name: sandboxName })
    const safeEnv = await getEnvVars(sandboxName)
    return await _launchDevAndProxy(sandbox, port, devScript, safeEnv)
  } catch (e) {
    return {
      sandboxName,
      previewDomain: "",
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

/**
 * Restart a sandbox by snapshotting the current filesystem and booting a new
 * VM from that snapshot. Preserves the working tree — including uncommitted
 * local changes — across the restart, while still cycling the VM (fresh
 * processes, fresh dev server, fresh port forwards). Doesn't fetch from the
 * remote: this is a pure restart, not a sync. Falls back to a clean git
 * clone if the old sandbox is gone or snapshotting fails.
 */
export async function restartSandbox(
  sandboxName: string,
  workspace: WorkspaceData,
  branch: string,
  ghToken?: string,
): Promise<SandboxResult> {
  try {
    if (!ghToken) ghToken = await getGitHubToken() ?? undefined
    const safeEnv = await getEnvVars(sandboxName)
    const port = workspace.devServerPort

    // Force a snapshot of the existing sandbox before deleting it so the new
    // VM can boot from the same filesystem state. snapshot() stops the VM as
    // a side effect — we still delete() afterwards so the name is free for
    // the new sandbox to claim. Either step may fail (sandbox missing,
    // snapshot expired, provider hiccup); the create below falls back to a
    // git source when no snapshotId is captured.
    let snapshotId: string | undefined
    try {
      const old = await sandboxProvider.get({ name: sandboxName, resume: false })
      try {
        const snap = await old.snapshot({ expiration: SNAPSHOT_EXPIRATION })
        snapshotId = snap.snapshotId
      } catch {}
      try { await old.delete() } catch {}
    } catch {}

    const networkPolicy = buildNetworkPolicy()
    const mergedEnv = { ...BROKERED_ANTHROPIC_ENV, ...(safeEnv ?? {}) }
    const source: SandboxSource = snapshotId
      ? { type: "snapshot", snapshotId }
      : ghToken
        ? { type: "git", url: workspace.cloneUrl, revision: branch, username: "x-access-token", password: ghToken }
        : { type: "git", url: workspace.cloneUrl, revision: branch }
    const sandbox = await sandboxProvider.create({
      name: sandboxName,
      source,
      ports: [port, port + PROXY_PORT_OFFSET],
      timeout: SANDBOX_TIMEOUT,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
      resources: { vcpus: SANDBOX_VCPUS },
      env: mergedEnv,
      networkPolicy,
    })

    if (snapshotId) {
      // Restored from snapshot — node_modules, git config, the credential
      // helper, and the working tree (uncommitted changes included) all
      // survived. Skip the setup/install/configure pipeline and just relaunch
      // the dev server.
      return await _launchDevAndProxy(sandbox, port, workspace.devScript, safeEnv)
    }

    // No snapshot available — fresh provision. Mirror the create pipeline:
    // deps + Claude Code in parallel, then git setup, then dev launch.
    // Claude Code is best-effort — already swallows its own errors.
    const setup = workspace.setupScript?.trim() || "npm install"
    const [setupCmd, ...setupArgs] = setup.split(/\s+/)
    const [setupResult] = await Promise.all([
      runLogged(sandbox, setupCmd, setupArgs),
      installClaudeCode(sandbox.name),
    ])
    if (setupResult.exitCode !== 0) {
      return {
        sandboxName: sandbox.name,
        previewDomain: "",
        status: "error",
        error: `Setup script failed (exit ${setupResult.exitCode})`,
      }
    }

    const gitResult = await configureAgentGit(sandbox.name, workspace, branch)
    if (!gitResult.success) {
      return {
        sandboxName: sandbox.name,
        previewDomain: "",
        status: "error",
        error: gitResult.error,
      }
    }

    return await _launchDevAndProxy(sandbox, port, workspace.devScript, safeEnv)
  } catch (e) {
    return {
      sandboxName,
      previewDomain: "",
      status: "error",
      error: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function removeSandboxEnv(sandboxName: string): Promise<void> {
  await deleteEnvVars(sandboxName)
}

/**
 * Extend a running sandbox's timeout so it stays alive while a user has the
 * page open. Each call adds SANDBOX_TIMEOUT to the current session, up to
 * the plan maximum (5 hours Pro). No-ops if the sandbox is already stopped.
 */
export async function keepAliveSandbox(
  sandboxName: string,
): Promise<{ success: boolean }> {
  try {
    const sandbox = await sandboxProvider.get({ name: sandboxName, resume: false })
    if (sandbox.status !== "running") return { success: false }
    await sandbox.extendTimeout(SANDBOX_TIMEOUT)
    return { success: true }
  } catch {
    return { success: false }
  }
}

function getWorkspaceEnv(envVarsText: string): Record<string, string> | undefined {
  const env = parseEnvVars(envVarsText)
  return Object.keys(env).length > 0 ? env : undefined
}

