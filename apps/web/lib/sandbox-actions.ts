"use server"

import { auth, clerkClient } from "@clerk/nextjs/server"
import { Sandbox } from "@vercel/sandbox"
import { storeEnvVars, getEnvVars, deleteEnvVars } from "./env-store"
import { createBranch, renameBranch } from "./github-actions"
import type { WorkspaceData } from "./liveblocks.types"

// 30 minutes — keep sandboxes alive only while actively used.
// Sandbox.get with resume:true will reboot the VM when a user returns.
const SANDBOX_TIMEOUT = 30 * 60 * 1000
// 24 hours — snapshots preserve the full filesystem (node_modules etc.)
const SNAPSHOT_EXPIRATION = 24 * 60 * 60 * 1000
// 1 vCPU = 2048 MB memory — sufficient for a Node.js dev server
const SANDBOX_VCPUS = 1

export interface SandboxResult {
  sandboxName: string
  previewDomain: string
  status: "running" | "error"
  error?: string
}

export async function getGitHubToken(): Promise<string | null> {
  const { userId } = await auth()
  if (!userId) return null

  const client = await clerkClient()
  const tokens = await client.users.getUserOauthAccessToken(userId, "github")
  const token = tokens.data?.[0]?.token
  return token ?? null
}

import { parseEnvVars } from "./env-utils"

const SANDBOX_LOG_PATH = "/tmp/screenplay/sandbox.log"

// Force ANSI color output from tools that would otherwise strip it because
// stdout is redirected to a file. FORCE_COLOR is respected by Node/npm/chalk,
// CLICOLOR_FORCE by git and many Unix tools, and TERM helps the rest.
const FORCE_COLOR_ENV =
  "FORCE_COLOR=1 CLICOLOR_FORCE=1 TERM=xterm-256color"

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
  sandbox: Awaited<ReturnType<typeof Sandbox.get>>,
  cmd: string,
  args: string[],
  options: { env?: Record<string, string>; label?: string } = {},
) {
  const label = options.label ?? `${cmd}${args.length ? " " + args.join(" ") : ""}`
  const header = shellQuote(`\n$ ${label}\n`)
  const quotedCmd = [cmd, ...args].map(shellQuote).join(" ")
  const script =
    `mkdir -p /tmp/screenplay; ` +
    `printf %s ${header} >> ${SANDBOX_LOG_PATH} 2>/dev/null; ` +
    `${FORCE_COLOR_ENV} ${quotedCmd} >> ${SANDBOX_LOG_PATH} 2>&1`
  return sandbox.runCommand({
    cmd: "sh",
    args: ["-c", script],
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

    const sandbox = await Sandbox.create({
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
      ports: [port, port + 1],
      timeout: SANDBOX_TIMEOUT,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
      resources: { vcpus: SANDBOX_VCPUS },
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
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
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })
    const setup = setupScript?.trim() || "npm install"
    const [setupCmd, ...setupArgs] = setup.split(/\s+/)
    await runLogged(sandbox, setupCmd, setupArgs)
    return { success: true }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Write the in-sandbox HTML-injecting proxy and DOM bridge script to
 * /tmp/screenplay/. Idempotent — safe to call on every dev-server start.
 * Uses /tmp because commands run as the `vercel-sandbox` user, which has no
 * read access to /root. The proxy forwards the public port (port + 1) to the
 * user's devserver on `port`, injecting a <script> tag that exposes a
 * postMessage DOM bridge.
 */
export async function installBridge(
  sandboxName: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })
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
 * URL (port + 1) rather than the devserver URL.
 */
async function _launchDevAndProxy(
  sandbox: Awaited<ReturnType<typeof Sandbox.get>>,
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
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      `mkdir -p /tmp/screenplay; ` +
        `printf %s ${devHeader} >> ${SANDBOX_LOG_PATH} 2>/dev/null; ` +
        `export ${FORCE_COLOR_ENV}; ` +
        `exec ${dev} >> ${SANDBOX_LOG_PATH} 2>&1`,
    ],
    detached: true,
    ...(env ? { env } : {}),
  })

  // Restart-on-crash wrapper so a proxy bug doesn't permanently dark the iframe.
  await sandbox.runCommand({
    cmd: "sh",
    args: [
      "-c",
      "while true; do node /tmp/screenplay/proxy.mjs; sleep 1; done",
    ],
    detached: true,
    env: {
      SCREENPLAY_UPSTREAM_PORT: String(port),
      SCREENPLAY_LISTEN_PORT: String(port + 1),
    },
  })

  return {
    sandboxName: sandbox.name,
    previewDomain: sandbox.domain(port + 1),
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
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })
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
    const check = await Sandbox.get({ name: sandboxName, resume: false })
    if (check.status === "running") {
      return {
        sandboxName: check.name,
        previewDomain: check.domain(port + 1),
        status: "running",
      }
    }

    // Sandbox timed out — resume it and restart the dev server
    const sandbox = await Sandbox.get({ name: sandboxName })
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
 * Restart a persistent sandbox. Auto-resume handles stopped sandboxes —
 * no need to recreate from scratch.
 */
export async function restartSandbox(
  sandboxName: string,
  gitUrl: string,
  branch: string,
  port: number = 3000,
  setupScript?: string,
  devScript?: string,
  ghToken?: string,
): Promise<SandboxResult> {
  try {
    const safeEnv = await getEnvVars(sandboxName)

    let sandbox: Awaited<ReturnType<typeof Sandbox.get>>
    let recreated = false
    try {
      // Sandbox.get auto-resumes stopped persistent sandboxes
      sandbox = await Sandbox.get({ name: sandboxName })
    } catch {
      // Sandbox no longer exists (snapshot expired / deleted) — recreate it
      if (!ghToken) ghToken = await getGitHubToken() ?? undefined
      const created = await Sandbox.create({
        name: sandboxName,
        source: ghToken
          ? { type: "git", url: gitUrl, revision: branch, username: "x-access-token", password: ghToken }
          : { type: "git", url: gitUrl, revision: branch },
        ports: [port, port + 1],
        timeout: SANDBOX_TIMEOUT,
        snapshotExpiration: SNAPSHOT_EXPIRATION,
        resources: { vcpus: SANDBOX_VCPUS },
        ...(safeEnv && Object.keys(safeEnv).length > 0 ? { env: safeEnv } : {}),
      })
      sandbox = created
      recreated = true
    }

    // Only pull if the sandbox already existed (freshly cloned sandboxes are up to date)
    if (!recreated) {
      await runLogged(sandbox, "git", ["pull", "origin", branch])
    }

    const setup = setupScript?.trim() || "npm install"
    const [setupCmd, ...setupArgs] = setup.split(/\s+/)
    await runLogged(sandbox, setupCmd, setupArgs)

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

export async function removeSandboxEnv(sandboxName: string): Promise<void> {
  await deleteEnvVars(sandboxName)
}

/**
 * Read the dev server log file from the sandbox. Returns the last N lines so
 * the response stays bounded even for long-running servers.
 */
export async function getSandboxLogs(
  sandboxName: string,
  maxLines: number = 1000,
): Promise<{ success: true; content: string } | { success: false; error: string }> {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })
    if (sandbox.status !== "running") {
      return { success: true, content: "" }
    }
    const result = await sandbox.runCommand("sh", [
      "-c",
      `tail -n ${maxLines} ${SANDBOX_LOG_PATH} 2>/dev/null || true`,
    ])
    const content = await result.stdout()
    return { success: true, content }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
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
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })
    if (sandbox.status !== "running") return { success: false }
    await sandbox.extendTimeout(SANDBOX_TIMEOUT)
    return { success: true }
  } catch {
    return { success: false }
  }
}

/**
 * Step 1: Create a Git branch on GitHub for the agent.
 */
export async function createAgentBranch(
  workspace: WorkspaceData,
  branchName: string,
  fromBranch?: string,
  ghToken?: string,
): Promise<{ success: boolean; error?: string }> {
  return createBranch(
    workspace.repoOwner,
    workspace.repoName,
    branchName,
    fromBranch || workspace.defaultBranch,
    ghToken,
  )
}

/**
 * Rename a branch in the sandbox and on GitHub (if it exists remotely).
 */
export async function renameAgentBranch(
  workspace: WorkspaceData,
  sandboxName: string,
  oldBranch: string,
  newBranch: string,
): Promise<{ success: boolean; error?: string }> {
  // Rename locally in the sandbox first — this always works
  try {
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })
    await sandbox.runCommand("git", ["branch", "-m", newBranch])
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }

  // Attempt GitHub rename — may not exist remotely yet (e.g. forked sandboxes)
  const result = await renameBranch(
    workspace.repoOwner,
    workspace.repoName,
    oldBranch,
    newBranch,
  )
  if (!result.success) {
    // Branch doesn't exist on GitHub yet — that's fine, it'll be pushed with the new name
    console.log(`GitHub branch rename skipped (${result.error}), will push as ${newBranch}`)
  }

  return { success: true }
}

/**
 * Discover routes by listing the project files and asking the LLM to identify them.
 */
export async function crawlRoutes(
  sandboxName: string,
): Promise<{ success: true; routes: { route: string; label: string }[] } | { success: false; error: string }> {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })

    // Get a broad file listing for the LLM to analyze
    const result = await sandbox.runCommand("find", [
      ".", "-maxdepth", "5", "-type", "f",
      "!", "-path", "*/node_modules/*",
      "!", "-path", "*/.git/*",
      "!", "-path", "*/.next/*",
      "!", "-path", "*/dist/*",
      "!", "-path", "*/.nuxt/*",
    ])
    const fileList = (await result.stdout()).trim()
    if (!fileList) return { success: true, routes: [{ route: "/", label: "Home" }] }

    const { getClient } = await import("@/lib/agent/config")
    const client = getClient()

    const res = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 1024,
      system: `You are analyzing a web project's file structure to discover its navigable routes.
Look at the file listing and determine the framework (Next.js, SvelteKit, Nuxt, Remix, React Router, Astro, plain React, etc.) and identify all static, user-facing routes.

Rules:
- Only return concrete, navigable routes (no dynamic segments like [id] or :id)
- Always include "/" if there's a home/index page
- Return ONLY a JSON array of objects with "route" and "label" keys, nothing else
- "label" should be a human-readable sentence case title for the route (e.g. "Home", "About us", "Blog posts")
- Example: [{"route": "/", "label": "Home"}, {"route": "/about", "label": "About"}, {"route": "/pricing", "label": "Pricing"}]
- If you can't determine routes, return [{"route": "/", "label": "Home"}]`,
      messages: [{
        role: "user",
        content: `Here are the project files:\n\n${fileList}`,
      }],
    })

    const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "[]"
    // Extract JSON array from response (handle markdown fences)
    const match = text.match(/\[[\s\S]*\]/)
    const parsed: { route: string; label: string }[] = match ? JSON.parse(match[0]) : [{ route: "/", label: "Home" }]

    return { success: true, routes: parsed }
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * Get line-level diff stats (additions/deletions) for a sandbox branch
 * compared to the default branch.
 */
/**
 * Get line-level diff stats (additions/deletions) for a sandbox branch
 * compared to the default branch. Uses the local origin ref to avoid
 * needing auth for a fresh fetch.
 */
export async function getDiffStats(
  sandboxName: string,
  defaultBranch: string,
): Promise<{ additions: number; deletions: number } | null> {
  try {
    const sandbox = await Sandbox.get({ name: sandboxName, resume: false })
    if (sandbox.status !== "running") return null

    // Try fetching silently — may fail on private repos without token, that's ok
    try { await sandbox.runCommand("git", ["fetch", "origin", defaultBranch, "--quiet"]) } catch {}

    // Use numstat for reliable machine-parseable output
    const result = await sandbox.runCommand("git", [
      "diff",
      "--numstat",
      `origin/${defaultBranch}`,
    ])
    const stdout = (await result.stdout()).trim()
    if (!stdout) return { additions: 0, deletions: 0 }

    let additions = 0
    let deletions = 0
    for (const line of stdout.split("\n")) {
      const [add, del] = line.split("\t")
      // Binary files show "-" for add/del
      if (add !== "-") additions += parseInt(add, 10) || 0
      if (del !== "-") deletions += parseInt(del, 10) || 0
    }

    return { additions, deletions }
  } catch {
    return null
  }
}

function getWorkspaceEnv(envVarsText: string): Record<string, string> | undefined {
  const env = parseEnvVars(envVarsText)
  return Object.keys(env).length > 0 ? env : undefined
}

/**
 * Step 3: Configure git auth and identity so the agent can push commits.
 * Also ensures we're on the correct branch (not detached HEAD) since
 * Sandbox.create with revision may leave HEAD detached.
 */
export async function configureAgentGit(
  sandboxName: string,
  workspace: WorkspaceData,
  branch: string,
  ghToken?: string,
): Promise<{ success: boolean; error?: string }> {
  if (!ghToken) ghToken = await getGitHubToken() ?? undefined
  if (!ghToken) {
    return { success: false, error: "No GitHub token available — the user may need to re-authenticate with GitHub." }
  }

  const sandbox = await Sandbox.get({ name: sandboxName, resume: false })

  // Ensure we're on the actual branch, not a detached HEAD.
  // Sandbox.create with `revision` may check out the commit directly.
  await sandbox.runCommand("git", ["checkout", "-B", branch])
  await sandbox.runCommand("git", ["branch", "--set-upstream-to", `origin/${branch}`, branch])

  const setUrl = await sandbox.runCommand("git", [
    "remote",
    "set-url",
    "origin",
    `https://x-access-token:${ghToken}@github.com/${workspace.repoOwner}/${workspace.repoName}.git`,
  ])
  if (setUrl.exitCode !== 0) {
    return { success: false, error: `Failed to set git remote URL (exit ${setUrl.exitCode})` }
  }

  await sandbox.runCommand("git", ["config", "user.email", "agent@screenplay.dev"])
  await sandbox.runCommand("git", ["config", "user.name", "Screenplay Agent"])
  await sandbox.runCommand("git", ["config", "push.default", "current"])

  return { success: true }
}
