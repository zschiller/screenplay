"use server"

import { getModelProviders } from "@/lib/agent/providers"
import { redactSensitiveInfo } from "@/lib/agent/redact"
import { deleteEnvVars, getEnvVars } from "@/lib/env-store"
import { sandboxProvider, supportsHibernation } from "@/lib/sandbox"
import { buildNetworkPolicy } from "@/lib/sandbox/network-policy"
import {
  BROKERED_ANTHROPIC_ENV,
  PROXY_PORT_OFFSET,
  SANDBOX_TIMEOUT,
  SANDBOX_VCPUS,
  SNAPSHOT_EXPIRATION,
  TERMINAL_PORT,
  launchDevAndProxy,
} from "@/lib/sandbox/provision-internals"
import { reprovisionFromGit } from "@/lib/sandbox/reprovision"
import { runSandboxAction } from "@/lib/sandbox/run"
import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { RepoData } from "@/lib/types"

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
 *
 * The auto-stop timer is a hibernation concern: a provider with no such timer
 * has nothing to extend, so on the non-hibernating path keep-alive is a clean
 * no-op (success) rather than an error.
 */
export async function keepAliveSandbox(
  sandboxName: string,
): Promise<SandboxActionResult<void>> {
  try {
    const sandbox = await sandboxProvider.get({ name: sandboxName, resume: false })
    if (!supportsHibernation(sandbox)) {
      // No auto-stop timer to push back — nothing to keep alive.
      return { success: true, value: undefined }
    }
    if (!sandbox.isRunning()) {
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
 * straight away rather than relaunching a dev server that's already up.
 *
 * When the VM is no longer running the recovery branches on the hibernation
 * capability: a hibernating provider resumes the stopped VM and relaunches the
 * dev + proxy (preserving the in-VM working tree); a non-hibernating provider
 * has no resume affordance, so it reclones fresh from git via
 * {@link reprovisionFromGit} — un-pushed edits are lost, an accepted
 * degradation. Takes the repo + branch so the reclone path has a source to
 * provision from. Returns the uniform contract — success/failure is the
 * discriminant, so the old `status` field is gone.
 */
export async function reconnectSandbox(
  sandboxName: string,
  repo: RepoData,
  branch: string,
  ghToken?: string,
): Promise<SandboxActionResult<{ sandboxName: string; previewDomain: string }>> {
  const port = repo.devServerPort
  let check
  try {
    // Check current status without resuming — a running sandbox is left
    // untouched so we don't spawn a duplicate dev server.
    check = await sandboxProvider.get({ name: sandboxName, resume: false })
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

  const safeEnv = await getEnvVars(sandboxName)

  // Not running. A non-hibernating provider can't resume a stopped VM — it
  // reclones fresh, the portable fallback.
  if (!supportsHibernation(check)) {
    return reprovisionFromGit(sandboxName, repo, branch, ghToken, safeEnv)
  }

  // Hibernating provider — resume the stopped VM and relaunch the dev server.
  // The runner resolves the instance (resuming it) and redacts any failure on
  // the way out.
  return runSandboxAction(sandboxName, async (sandbox) => {
    const previewDomain = await launchDevAndProxy(sandbox, port, repo.devScript, safeEnv)
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
 * Snapshot/restore is the hibernation path. A non-hibernating provider can't
 * snapshot, so it skips straight to the reclone-fresh branch (working-tree
 * preservation is the accepted degradation there).
 *
 * Creates a VM rather than resolving an existing one, so it can't ride the
 * `get`-based runner — it builds the uniform contract itself and redacts the
 * error on the failure path (a clone or provider failure can spill the GitHub
 * token baked into the source URL). The internal setup/git failures throw so
 * the single catch redacts them uniformly.
 */
export async function restartSandbox(
  sandboxName: string,
  repo: RepoData,
  branch: string,
  ghToken?: string,
): Promise<SandboxActionResult<{ sandboxName: string; previewDomain: string }>> {
  try {
    const safeEnv = await getEnvVars(sandboxName)
    const port = repo.devServerPort

    // Force a snapshot of the existing sandbox before deleting it so the new
    // VM can boot from the same filesystem state. snapshot() stops the VM as a
    // side effect — we still delete() afterwards so the name is free for the
    // new sandbox to claim. Either step may fail (sandbox missing, snapshot
    // expired, provider hiccup); we fall back to a fresh git clone when no
    // snapshotId is captured.
    let snapshotId: string | undefined
    try {
      const old = await sandboxProvider.get({ name: sandboxName, resume: false })
      // Only a hibernating provider can capture a snapshot; a portable one
      // leaves snapshotId unset and falls through to the reclone path below.
      if (supportsHibernation(old)) {
        try {
          const snap = await old.snapshot({ expiration: SNAPSHOT_EXPIRATION })
          snapshotId = snap.snapshotId
        } catch {}
      }
      try {
        await old.delete()
      } catch {}
    } catch {}

    if (!snapshotId) {
      // No snapshot available — reclone fresh from git. reprovisionFromGit owns
      // that whole path (create-from-git through dev launch) and returns the
      // uniform redacted contract, so we hand back its result directly.
      return reprovisionFromGit(sandboxName, repo, branch, ghToken, safeEnv)
    }

    // Restored from snapshot — node_modules, git config, the credential helper,
    // and the working tree (uncommitted changes included) all survived. Boot a
    // new VM from the snapshot and just relaunch the dev server, skipping the
    // setup/install/configure pipeline entirely.
    const networkPolicy = buildNetworkPolicy(getModelProviders())
    const mergedEnv = { ...BROKERED_ANTHROPIC_ENV, ...(safeEnv ?? {}) }
    const sandbox = await sandboxProvider.create({
      name: sandboxName,
      source: { type: "snapshot", snapshotId },
      ports: [port, port + PROXY_PORT_OFFSET, TERMINAL_PORT],
      timeout: SANDBOX_TIMEOUT,
      snapshotExpiration: SNAPSHOT_EXPIRATION,
      resources: { vcpus: SANDBOX_VCPUS },
      env: mergedEnv,
      networkPolicy,
    })

    const previewDomain = await launchDevAndProxy(sandbox, port, repo.devScript, safeEnv)
    return { success: true, value: { sandboxName: sandbox.name, previewDomain } }
  } catch (e) {
    return { success: false, error: redactSensitiveInfo(e instanceof Error ? e.message : String(e)) }
  }
}
