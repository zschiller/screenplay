"use server"

import { getGitHubTokenForUser, getUserId } from "@/lib/auth-helpers"
import { sandboxProvider } from "@/lib/sandbox"
import type { SandboxSource } from "@/lib/sandbox"
import { configureAgentGit } from "@/lib/sandbox/git"
import { installClaudeCode } from "@/lib/sandbox/provision"
import {
  BROKERED_ANTHROPIC_ENV,
  PROXY_PORT_OFFSET,
  SANDBOX_TIMEOUT,
  SANDBOX_VCPUS,
  SNAPSHOT_EXPIRATION,
  buildNetworkPolicy,
  launchDevAndProxy,
  runLogged,
} from "@/lib/sandbox/provision-internals"
import { deleteEnvVars, getEnvVars } from "./env-store"
import type { WorkspaceData } from "./types"

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
    const previewDomain = await launchDevAndProxy(sandbox, port, devScript, safeEnv)
    return { sandboxName: sandbox.name, previewDomain, status: "running" }
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
      const previewDomain = await launchDevAndProxy(sandbox, port, workspace.devScript, safeEnv)
      return { sandboxName: sandbox.name, previewDomain, status: "running" }
    }

    // No snapshot available — fresh provision. Mirror the create pipeline:
    // deps + Claude Code in parallel, then git setup, then dev launch.
    // Claude Code is best-effort — the create route ignores its result, and so
    // do we here.
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

    const previewDomain = await launchDevAndProxy(sandbox, port, workspace.devScript, safeEnv)
    return { sandboxName: sandbox.name, previewDomain, status: "running" }
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
