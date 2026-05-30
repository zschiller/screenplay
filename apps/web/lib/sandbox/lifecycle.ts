"use server"

import { redactSensitiveInfo } from "@/lib/agent/redact"
import { getGitHubToken } from "@/lib/auth-helpers"
import { deleteEnvVars, getEnvVars } from "@/lib/env-store"
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
  TERMINAL_PORT,
  buildNetworkPolicy,
  launchDevAndProxy,
  runLogged,
} from "@/lib/sandbox/provision-internals"
import { runSandboxAction } from "@/lib/sandbox/run"
import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { WorkspaceData } from "@/lib/types"

/**
 * Check if a sandbox preview URL is responding with real content. The sandbox
 * proxy may return 200 with an empty/placeholder page before the dev server is
 * actually listening, so we verify the body has HTML markup. A plain boolean
 * probe — no sandbox command runs — so it stays outside the result contract.
 */
export async function probeSandboxUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "text/html" },
    })
    if (!res.ok) return false
    const body = await res.text()
    // A real dev server response will contain HTML markup. Proxy placeholders /
    // blank pages won't have a <body> or <div> tag.
    return body.includes("<body") || body.includes("<div")
  } catch {
    return false
  }
}

/**
 * Forget the persisted env vars for a sandbox. Pure KV cleanup — no sandbox
 * command runs — so it stays outside the result contract and returns void.
 */
export async function removeSandboxEnv(sandboxName: string): Promise<void> {
  await deleteEnvVars(sandboxName)
}

/**
 * Extend a running sandbox's timeout so it stays alive while a user has the
 * page open. Each call adds SANDBOX_TIMEOUT to the current session, up to the
 * plan maximum (5 hours Pro). Resolves with `resume:false` so a stopped sandbox
 * stays stopped — the keep-alive heartbeat must never wake a VM the user has
 * walked away from — and reports that as a failure rather than reviving it.
 */
export async function keepAliveSandbox(
  sandboxName: string,
): Promise<SandboxActionResult<void>> {
  try {
    const sandbox = await sandboxProvider.get({ name: sandboxName, resume: false })
    if (sandbox.status !== "running") {
      return { success: false, error: "Sandbox is not running" }
    }
    await sandbox.extendTimeout(SANDBOX_TIMEOUT)
    return { success: true, value: undefined }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return { success: false, error: redactSensitiveInfo(message) }
  }
}

/**
 * Reconnect to a sandbox after a page reload. Probes the current state with
 * `resume:false` first: if the VM is still running, returns its preview domain
 * straight away rather than relaunching a dev server that's already up. If it
 * has timed out, resumes it and relaunches the dev + proxy through the runner.
 * Returns the uniform contract — success/failure is the discriminant, so the
 * old `status` field is gone.
 */
export async function reconnectSandbox(
  sandboxName: string,
  port: number = 3000,
  devScript?: string,
): Promise<SandboxActionResult<{ sandboxName: string; previewDomain: string }>> {
  try {
    // Check current status without resuming — a running sandbox is left
    // untouched so we don't spawn a duplicate dev server.
    const check = await sandboxProvider.get({ name: sandboxName, resume: false })
    if (check.status === "running") {
      return {
        success: true,
        value: {
          sandboxName: check.name,
          previewDomain: check.domain(port + PROXY_PORT_OFFSET),
        },
      }
    }
  } catch (e) {
    return { success: false, error: redactSensitiveInfo(e instanceof Error ? e.message : String(e)) }
  }

  // Timed out — resume it and restart the dev server. The runner resolves the
  // instance (resuming it) and redacts any failure on the way out.
  return runSandboxAction(sandboxName, async (sandbox) => {
    const safeEnv = await getEnvVars(sandboxName)
    const previewDomain = await launchDevAndProxy(sandbox, port, devScript, safeEnv)
    return { sandboxName: sandbox.name, previewDomain }
  })
}

/**
 * Restart a sandbox by snapshotting the current filesystem and booting a new VM
 * from that snapshot. Preserves the working tree — including uncommitted local
 * changes — across the restart, while still cycling the VM (fresh processes,
 * dev server, port forwards). Doesn't fetch from the remote: this is a pure
 * restart, not a sync. Falls back to a clean git clone if the old sandbox is
 * gone or snapshotting fails.
 *
 * Creates a VM rather than resolving an existing one, so it can't ride the
 * `get`-based runner — it builds the uniform contract itself and redacts the
 * error on the failure path (a clone or provider failure can spill the GitHub
 * token baked into the source URL). The internal setup/git failures throw so
 * the single catch redacts them uniformly.
 */
export async function restartSandbox(
  sandboxName: string,
  workspace: WorkspaceData,
  branch: string,
  ghToken?: string,
): Promise<SandboxActionResult<{ sandboxName: string; previewDomain: string }>> {
  try {
    if (!ghToken) ghToken = (await getGitHubToken()) ?? undefined
    const safeEnv = await getEnvVars(sandboxName)
    const port = workspace.devServerPort

    // Force a snapshot of the existing sandbox before deleting it so the new
    // VM can boot from the same filesystem state. snapshot() stops the VM as a
    // side effect — we still delete() afterwards so the name is free for the
    // new sandbox to claim. Either step may fail (sandbox missing, snapshot
    // expired, provider hiccup); the create below falls back to a git source
    // when no snapshotId is captured.
    let snapshotId: string | undefined
    try {
      const old = await sandboxProvider.get({ name: sandboxName, resume: false })
      try {
        const snap = await old.snapshot({ expiration: SNAPSHOT_EXPIRATION })
        snapshotId = snap.snapshotId
      } catch {}
      try {
        await old.delete()
      } catch {}
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
      ports: [port, port + PROXY_PORT_OFFSET, TERMINAL_PORT],
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
      return { success: true, value: { sandboxName: sandbox.name, previewDomain } }
    }

    // No snapshot available — fresh provision. Mirror the create pipeline:
    // deps + Claude Code in parallel, then git setup, then dev launch. Claude
    // Code is best-effort — the create route ignores its result, and so do we.
    const setup = workspace.setupScript?.trim() || "npm install"
    const [setupCmd, ...setupArgs] = setup.split(/\s+/)
    const [setupResult] = await Promise.all([
      runLogged(sandbox, setupCmd, setupArgs),
      installClaudeCode(sandbox.name),
    ])
    if (setupResult.exitCode !== 0) {
      throw new Error(`Setup script failed (exit ${setupResult.exitCode})`)
    }

    const gitResult = await configureAgentGit(sandbox.name, workspace, branch)
    if (!gitResult.success) {
      throw new Error(gitResult.error ?? "Failed to configure git")
    }

    const previewDomain = await launchDevAndProxy(sandbox, port, workspace.devScript, safeEnv)
    return { success: true, value: { sandboxName: sandbox.name, previewDomain } }
  } catch (e) {
    return { success: false, error: redactSensitiveInfo(e instanceof Error ? e.message : String(e)) }
  }
}
