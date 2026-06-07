"use server"

import { getModelProviders } from "@/lib/agent/providers"
import { buildBrokeredEnv, selectHarnesses } from "@/lib/agent/harnesses"
import { redactSensitiveInfo } from "@/lib/agent/redact"
import { deleteEnvVars, getEnvVars } from "@/lib/env-store"
import {
  isSandboxRunning,
  sandboxProvider,
  supportsHibernation,
} from "@/lib/sandbox"
import type { SandboxInstance } from "@/lib/sandbox"
import { buildNetworkPolicy } from "@/lib/sandbox/network-policy"
import {
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
 * Check if a sandbox preview URL is reachable. The bridge proxy serves its
 * "dev server not ready" placeholder with a 5xx status (see servePlaceholder in
 * proxy.mjs), so any non-5xx response means the dev server itself answered.
 *
 * Deliberately lightweight: it does NOT download or parse the page body. The
 * old version did a full `GET` + `res.text()` and sniffed for HTML markup, which
 * meant every preview was fetched twice in series — once here, then again by the
 * iframe — roughly doubling time-to-first-paint on a warm server. A redirect
 * (e.g. "/" -> "/login") is a live server too, so it's treated as reachable
 * instead of following the chain. A plain boolean probe — no sandbox command
 * runs — so it stays outside the result contract.
 */
export async function probeSandboxUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
      headers: { Accept: "text/html" },
    })
    // Don't consume the body — reachability is all we need, and the iframe
    // re-fetches the URL itself. Discard the stream so the connection frees.
    res.body?.cancel().catch(() => {})
    // `redirect: "manual"` surfaces a 3xx as an opaque-redirect response; either
    // way, anything that isn't a 5xx proxy placeholder means the server is up.
    return (
      res.type === "opaqueredirect" || (res.status >= 200 && res.status < 500)
    )
  } catch {
    return false
  }
}

// How many times to probe the preview before concluding it's actually dead and
// relaunching. A healthy server answers on the first probe; the extra attempts
// exist purely to ride out a transient hiccup or a dev server that's still in
// its cold-start window, so a reconnect doesn't tear down and relaunch a server
// that was about to answer.
const PREVIEW_PROBE_ATTEMPTS = 3
// Delay between those attempts. Short enough that detecting a genuinely dead
// server still relaunches promptly, long enough to give a slow cold start room
// to come up. (Each probe itself carries a 5s fetch timeout.)
const PREVIEW_PROBE_DELAY_MS = 2000

export interface EnsurePreviewLiveOptions {
  /** Probe attempts before relaunching. Defaults to {@link PREVIEW_PROBE_ATTEMPTS}. */
  probeAttempts?: number
  /** Delay between probe attempts in ms. Defaults to {@link PREVIEW_PROBE_DELAY_MS}. */
  probeDelayMs?: number
}

/**
 * Ensure a live VM's preview is actually answering, relaunching the dev server
 * and proxy when it isn't. Probes the proxy domain first: a healthy, reachable
 * preview is handed straight back untouched — no needless relaunch of a dev
 * server that's already up. The probe is retried a few times before giving up,
 * so a transient hiccup or a still-warming cold start doesn't trigger a relaunch
 * of a server that was about to answer. Only when every attempt fails (the VM
 * kept running but the dev server or bridge proxy truly died) does it relaunch
 * both and return the preview domain, which now points at the freshly launched
 * proxy.
 *
 * This is the reachability-check-and-relaunch half of the reconnect self-heal:
 * a page reload onto a stuck-but-live VM recovers the preview instead of handing
 * back a dead URL the client can only spin on. Throws if the relaunch fails —
 * callers running through the runner (or their own redacting catch) turn that
 * into a redacted failure result.
 */
export async function ensurePreviewLive(
  sandbox: SandboxInstance,
  port: number,
  devScript?: string,
  env?: Record<string, string> | null,
  options: EnsurePreviewLiveOptions = {}
): Promise<string> {
  const {
    probeAttempts = PREVIEW_PROBE_ATTEMPTS,
    probeDelayMs = PREVIEW_PROBE_DELAY_MS,
  } = options
  const previewDomain = sandbox.domain(port + PROXY_PORT_OFFSET)
  for (let attempt = 0; attempt < probeAttempts; attempt++) {
    if (await probeSandboxUrl(previewDomain)) {
      return previewDomain
    }
    if (attempt < probeAttempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, probeDelayMs))
    }
  }
  return launchDevAndProxy(sandbox, port, devScript, env)
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
  sandboxName: string
): Promise<SandboxActionResult<void>> {
  try {
    const sandbox = await sandboxProvider.get({
      name: sandboxName,
      resume: false,
    })
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
 * `resume:false` first: if the sandbox is live, routes through
 * {@link ensurePreviewLive} — which returns the preview domain straight away
 * when it's reachable, and relaunches the dev server + proxy only when a live
 * VM's preview has gone dark (so a reload self-heals a stuck-but-live VM instead
 * of handing back a dead URL).
 *
 * Liveness is read through the portable {@link isSandboxRunning} predicate, not
 * a `status === "running"` literal. A portable backend has no stopped-but-present
 * state — its handle is live for as long as it exists — so a successful probe
 * always lands in the live branch. Only a hibernating provider can observe a
 * stopped-but-present VM; it resumes the VM (the runner's `get` wakes it) and
 * relaunches the dev + proxy, preserving the in-VM working tree.
 *
 * If the probe throws (the sandbox is gone), the failure surfaces and the caller
 * recreates from git via {@link recreateSandbox} — so reconnect itself never
 * needs a reclone branch or a git source. Returns the uniform contract.
 */
export async function reconnectSandbox(
  sandboxName: string,
  repo: RepoData
): Promise<
  SandboxActionResult<{ sandboxName: string; previewDomain: string }>
> {
  const port = repo.devServerPort
  let check
  try {
    // Check current state without resuming — a live, reachable sandbox is left
    // untouched so we don't spawn a duplicate dev server.
    check = await sandboxProvider.get({ name: sandboxName, resume: false })
  } catch (e) {
    return {
      success: false,
      error: redactSensitiveInfo(e instanceof Error ? e.message : String(e)),
    }
  }

  if (isSandboxRunning(check)) {
    // The VM is up, but its dev server or bridge proxy may have died while it
    // kept running. ensurePreviewLive probes the preview and relaunches only
    // when it's unreachable, so a healthy preview rides the fast path untouched.
    // We already hold the live handle, so reuse it rather than resolving again —
    // and wrap the relaunch in the same redacting catch as the resume path.
    const safeEnv = await getEnvVars(sandboxName)
    try {
      const previewDomain = await ensurePreviewLive(
        check,
        port,
        repo.devScript,
        safeEnv
      )
      return {
        success: true,
        value: { sandboxName: check.name, previewDomain },
      }
    } catch (e) {
      return {
        success: false,
        error: redactSensitiveInfo(e instanceof Error ? e.message : String(e)),
      }
    }
  }

  // Present but stopped — reachable only on a hibernating provider. Resume the
  // VM and relaunch the dev server. The runner resolves the instance (resuming
  // it) and redacts any failure on the way out.
  const safeEnv = await getEnvVars(sandboxName)
  return runSandboxAction(sandboxName, async (sandbox) => {
    const previewDomain = await launchDevAndProxy(
      sandbox,
      port,
      repo.devScript,
      safeEnv
    )
    return { sandboxName: sandbox.name, previewDomain }
  })
}

/**
 * Restart a sandbox by snapshotting the current filesystem and booting a new VM
 * from that snapshot. Preserves the working tree — including uncommitted local
 * changes — across the restart, while still cycling the VM (fresh processes,
 * dev server, port forwards). Doesn't fetch from the remote: this is a pure
 * restart, not a sync.
 *
 * Snapshot/restore is the hibernation path, and it is the *only* path: on a
 * snapshot miss — snapshotting failed, or the provider can't hibernate at all —
 * this **fails loud** rather than quietly recloning. The old silent reclone
 * fallback was removed deliberately so a restart can never discard uncommitted
 * work; rebuilding from git is now only ever the explicit, confirmed
 * {@link recreateSandbox} ("Recreate from scratch"). See ADR 0005.
 *
 * Creates a VM rather than resolving an existing one, so it can't ride the
 * `get`-based runner — it builds the uniform contract itself and redacts the
 * error on the failure path (a provider failure can spill credentials). The
 * internal setup/git failures throw so the single catch redacts them uniformly.
 */
export async function restartSandbox(
  sandboxName: string,
  repo: RepoData
): Promise<
  SandboxActionResult<{ sandboxName: string; previewDomain: string }>
> {
  try {
    const safeEnv = await getEnvVars(sandboxName)
    const port = repo.devServerPort

    // Force a snapshot of the existing sandbox before deleting it so the new
    // VM can boot from the same filesystem state. snapshot() stops the VM as a
    // side effect — we still delete() afterwards so the name is free for the
    // new sandbox to claim. Either step may fail (sandbox missing, snapshot
    // expired, provider hiccup); on any miss we fail loud below rather than
    // recloning and discarding the working tree.
    let snapshotId: string | undefined
    try {
      const old = await sandboxProvider.get({
        name: sandboxName,
        resume: false,
      })
      // Only a hibernating provider can capture a snapshot; a portable one
      // leaves snapshotId unset and falls into the fail-loud branch below.
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
      // No snapshot captured (snapshotting failed, or a non-hibernating
      // provider). Fail rather than silently recloning — discarding uncommitted
      // work is reserved for the explicit, confirmed "Recreate from scratch".
      return {
        success: false,
        error:
          "Couldn't snapshot the sandbox to restart it. Use “Recreate from scratch” to rebuild it from git (this discards uncommitted changes).",
      }
    }

    // Restored from snapshot — node_modules, git config, the credential helper,
    // and the working tree (uncommitted changes included) all survived. Boot a
    // new VM from the snapshot and just relaunch the dev server, skipping the
    // setup/install/configure pipeline entirely.
    const providers = getModelProviders()
    const networkPolicy = buildNetworkPolicy(providers)
    const installable = selectHarnesses(
      process.env.SANDBOX_HARNESSES,
      providers
    ).installable
    const mergedEnv = { ...buildBrokeredEnv(installable), ...(safeEnv ?? {}) }
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

    const previewDomain = await launchDevAndProxy(
      sandbox,
      port,
      repo.devScript,
      safeEnv
    )
    return {
      success: true,
      value: { sandboxName: sandbox.name, previewDomain },
    }
  } catch (e) {
    return {
      success: false,
      error: redactSensitiveInfo(e instanceof Error ? e.message : String(e)),
    }
  }
}

/**
 * Recreate a sandbox from scratch: delete the existing VM and reclone the repo
 * fresh from git, running the full setup pipeline. This is the **destructive**
 * path — it discards the in-VM working tree, including any uncommitted changes —
 * so it is the explicit, separately-routed operation the UI gates behind a
 * confirm, never a silent fallback ({@link restartSandbox} fails loud instead of
 * recloning; see ADR 0005).
 *
 * Used both by the "Recreate from scratch" menu action and by auto-recovery on
 * reconnect when a sandbox's snapshot has fully expired (so there is nothing
 * left to restore from and recloning is the only way back to a live preview).
 *
 * Frees the old name first (best-effort — a missing or wedged VM shouldn't block
 * recreating) then delegates to {@link reprovisionFromGit}, which owns the whole
 * create-from-git-through-dev-launch path and returns the uniform redacted
 * contract.
 */
export async function recreateSandbox(
  sandboxName: string,
  repo: RepoData,
  branch: string,
  ghToken?: string
): Promise<
  SandboxActionResult<{ sandboxName: string; previewDomain: string }>
> {
  const safeEnv = await getEnvVars(sandboxName)
  // Free the name so the fresh clone can claim it. Best-effort: the old VM may
  // be gone (expired snapshot) or wedged, neither of which should block a
  // recreate.
  try {
    const old = await sandboxProvider.get({ name: sandboxName, resume: false })
    await old.delete()
  } catch {}
  return reprovisionFromGit(sandboxName, repo, branch, ghToken, safeEnv)
}

/**
 * Restart just the dev server inside an already-running Sandbox. Bounces the
 * `devScript` process (and the bridge proxy) in place — no VM cycle, so the
 * filesystem and working tree, including uncommitted changes, are untouched.
 * This is the cheap, common recovery for a wedged preview, and stays usable even
 * while the agent is working because it never touches the VM lifecycle.
 *
 * Resolves the live handle with `resume:false` and bails when the VM isn't
 * running: a dev-server bounce is meaningless on a stopped VM, and waking one
 * would be a VM cycle in disguise ({@link restartSandbox} owns that). It only
 * ever `get`s an existing instance and relaunches through it — no `create` is
 * issued — so the operation provably doesn't cycle the VM. Builds the uniform
 * contract itself and redacts the error on the failure path (launchDevAndProxy
 * can surface provider messages).
 */
export async function restartDevServer(
  sandboxName: string,
  repo: RepoData
): Promise<SandboxActionResult<{ previewDomain: string }>> {
  try {
    const sandbox = await sandboxProvider.get({
      name: sandboxName,
      resume: false,
    })
    if (!isSandboxRunning(sandbox)) {
      return { success: false, error: "Sandbox is not running" }
    }
    const safeEnv = await getEnvVars(sandboxName)
    const previewDomain = await launchDevAndProxy(
      sandbox,
      repo.devServerPort,
      repo.devScript,
      safeEnv
    )
    return { success: true, value: { previewDomain } }
  } catch (e) {
    return {
      success: false,
      error: redactSensitiveInfo(e instanceof Error ? e.message : String(e)),
    }
  }
}
