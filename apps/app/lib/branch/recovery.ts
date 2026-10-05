import {
  reconnectSandbox,
  recreateSandbox,
  stopWorkspaceSandbox,
  restartDevServer as restartDevServerSandbox,
  stopDevServer as stopDevServerSandbox,
  restartSandbox as restartSandboxVm,
} from "@/lib/sandbox/lifecycle"
import type { SandboxActionResult } from "@/lib/sandbox/run"
import type { RepoData } from "@/lib/types"

/**
 * Branch recovery — the three named domain verbs for bringing a Branch's
 * Sandbox back to life, lifted out of `components/canvas/canvas.tsx`.
 *
 *  - **Dev Server Restart** ({@link restartDevServer}) — bounce the dev server
 *    in place. No VM cycle, no status flip, and the *only* recovery available
 *    mid-turn (it never touches the VM lifecycle, so an in-flight agent run is
 *    undisturbed). A thin path of its own, deliberately not folded into the
 *    runner below.
 *  - **Sandbox Restart** ({@link restartSandbox}) — snapshot-restore onto a
 *    fresh VM, preserving the working tree. Fails loud on a snapshot miss (no
 *    silent reclone — ADR 0005).
 *  - **Recreate** ({@link recreate}) — the explicit, confirm-gated, destructive
 *    reclone from git that discards the in-VM working tree.
 *
 * Sandbox Restart and Recreate are near-identical orchestrations — lookup +
 * guard → flip status to `starting` → await a sandbox fn → on success write
 * `running` + the new sandbox name / preview + a success toast, on failure
 * write `error` + an error toast — so they share one {@link runSandboxRecovery}
 * runner that differs only in its labels and the sandbox fn it awaits. ADR 0005
 * routing (which verb runs by conflict risk) lives at the call site and is
 * unchanged.
 *
 * The runner works over injected seams — the agent store ({@link patchAgent}),
 * the lookups, and the toasts — so it is testable with plain doubles, no React.
 */

/**
 * The slice of a Branch the recovery verbs read. {@link BranchData} satisfies
 * it structurally; only these fields are touched, so the seam stays narrow.
 */
export interface RecoveryAgent {
  /** Which {@link RepoData} backs this Branch — the key the repo lookup uses. */
  repoId: string
  sandboxName: string
  previewDomain: string
  /** The git ref recreate reclones from. */
  ref: string
  /** Set while someone has the dev server stopped (#1342). */
  devServerStoppedAt?: number
}

/**
 * The fields the runner patches onto the Branch record. A subset of
 * `Partial<BranchData>`, so the real `updateAgentInStorage` is a drop-in.
 */
export interface RecoveryPatch {
  sandboxName?: string
  previewDomain?: string
  status?: "starting" | "running" | "error" | "stopped"
  statusMessage?: string
  error?: string
  doneAt?: number
  devServerStoppedAt?: number
  devServerLaunchedAt?: number
  codeReady?: boolean
}

/** Surface success / failure to the user. Adapts the sonner `toast` at the call site. */
export interface RecoveryToasts {
  success: (message: string) => void
  error: (message: string, description?: string) => void
}

/** The injected seams every recovery verb runs over. */
export interface BranchRecoveryDeps {
  /** The Canvas, so Recreate can read the Repo's env var values (#1416). */
  roomId: string
  /** Look up the Branch being recovered. Missing → the verb is a silent no-op
   *  (the Branch vanished out from under the menu before the click landed). */
  findAgent: (id: string) => RecoveryAgent | undefined
  /** Look up the Repo backing the Branch. Missing → the verb reports an error. */
  findRepo: (repoId: string) => RepoData | undefined
  /** Patch the Branch record (the agent-store seam). */
  patchAgent: (id: string, patch: RecoveryPatch) => void
  toast: RecoveryToasts
}

/**
 * How a VM-cycling recovery settled, for callers that need more than the toast
 * (the Recreate confirm shows a failure inline). A vanished Branch is `ok`: a
 * silent no-op, nothing to report.
 */
export type RecoveryOutcome = { ok: true } | { ok: false; error: string }

/** What a VM-cycling recovery fn returns: the (possibly new) sandbox + preview. */
type SandboxRecoveryResult = SandboxActionResult<{
  sandboxName: string
  previewDomain: string
}>

/**
 * The user-facing copy + sandbox fn that distinguishes Sandbox Restart from
 * Recreate. Everything else about the two flows is identical, so it lives in
 * {@link runSandboxRecovery}.
 */
interface SandboxRecoverySpec {
  /** Transient status line while the sandbox fn runs ("Restarting sandbox…"). */
  startingMessage: string
  /** Toast on success ("Sandbox restarted"); none when the change speaks for itself. */
  successMessage?: string
  /** Toast title on failure / a missing repo ("Couldn't restart sandbox"). */
  failureTitle: string
  /**
   * The checkout is already there, so the agent can start at once rather than
   * when the sandbox fn marks the Branch `codeReady` (the local dev server
   * restart).
   */
  codeReadyAtStart?: boolean
  /**
   * The sandbox fn to await — bound to restartSandbox / recreateSandbox, which
   * mark the Branch (`id`) `codeReady` once its code is back.
   */
  run: (
    agent: RecoveryAgent,
    repo: RepoData,
    id: string
  ) => Promise<SandboxRecoveryResult>
}

/**
 * The shared runner behind Sandbox Restart and Recreate: lookup + guard, flip
 * the Branch to `starting`, await the verb's sandbox fn, then write the terminal
 * status (`running` on success, `error` on failure) and toast. A missing Branch
 * is a silent no-op; a missing Repo flips straight to `error` without ever
 * awaiting the sandbox fn.
 */
async function runSandboxRecovery(
  id: string,
  spec: SandboxRecoverySpec,
  deps: BranchRecoveryDeps
): Promise<RecoveryOutcome> {
  const agent = deps.findAgent(id)
  if (!agent?.sandboxName) return { ok: true }

  const repo = deps.findRepo(agent.repoId)
  if (!repo) {
    deps.patchAgent(id, { status: "error", error: "Repository not found" })
    deps.toast.error(spec.failureTitle, "Repository not found")
    return { ok: false, error: "Repository not found" }
  }

  deps.patchAgent(id, {
    status: "starting",
    statusMessage: spec.startingMessage,
    codeReady: spec.codeReadyAtStart || undefined,
  })

  // A thrown call (the server action's request failed) is a failure like any
  // other, not a Branch stuck on `starting`.
  const result = await spec
    .run(agent, repo, id)
    .catch((err: unknown): SandboxRecoveryResult => ({
      success: false,
      error: err instanceof Error ? err.message : String(err),
    }))
  if (result.success) {
    deps.patchAgent(id, {
      sandboxName: result.value.sandboxName,
      // A new VM may report the same preview port; fall back to the old domain
      // so a blank value never wipes a working preview.
      previewDomain: result.value.previewDomain || agent.previewDomain,
      status: "running",
      statusMessage: "",
      error: "",
      codeReady: undefined,
      // Every path through here launched the dev server.
      devServerStoppedAt: undefined,
      devServerLaunchedAt: Date.now(),
    })
    if (spec.successMessage) deps.toast.success(spec.successMessage)
    return { ok: true }
  } else {
    // The status message stays: it names the step that failed, which titles
    // the sidebar's failure card.
    deps.patchAgent(id, {
      status: "error",
      error: result.error || spec.failureTitle,
      codeReady: undefined,
    })
    deps.toast.error(spec.failureTitle, result.error || undefined)
    return { ok: false, error: result.error || spec.failureTitle }
  }
}

/**
 * **Dev Server Restart** — bounce the dev server inside an already-running
 * Sandbox. The thin path: no VM cycle and no status flip, so it stays usable
 * mid-turn while the agent works, and a blank preview port means there's
 * nothing to persist — the only signal is a toast. A missing Repo is reported
 * without flipping status (there's no status to flip on this path). A stopped
 * dev server (#1342) runs again: the stop is cleared up front, so every member
 * sees it start, and put back if the launch fails.
 */
export function restartDevServer(
  id: string,
  deps: BranchRecoveryDeps
): Promise<void> {
  return launchDevServer(id, deps, {
    successMessage: "Preview restarted",
    failureTitle: "Couldn’t restart preview",
  })
}

/**
 * **Dev Server Run** (#1342) — start a stopped dev server again. The same
 * launch as {@link restartDevServer}; the dot turning green is the only
 * signal, so there's no success toast.
 */
export function runDevServer(
  id: string,
  deps: BranchRecoveryDeps
): Promise<void> {
  return launchDevServer(id, deps, {
    failureTitle: "Couldn’t run preview",
  })
}

async function launchDevServer(
  id: string,
  deps: BranchRecoveryDeps,
  copy: { successMessage?: string; failureTitle: string }
): Promise<void> {
  const agent = deps.findAgent(id)
  if (!agent?.sandboxName) return

  const repo = deps.findRepo(agent.repoId)
  if (!repo) {
    deps.toast.error(copy.failureTitle, "Repository not found")
    return
  }

  const stoppedAt = agent.devServerStoppedAt
  deps.patchAgent(id, {
    devServerStoppedAt: undefined,
    devServerLaunchedAt: Date.now(),
  })
  const result = await restartDevServerSandbox(agent.sandboxName, repo).catch(
    (err: unknown) => ({
      success: false as const,
      error: err instanceof Error ? err.message : String(err),
    })
  )
  if (result.success) {
    if (copy.successMessage) deps.toast.success(copy.successMessage)
  } else {
    if (stoppedAt) deps.patchAgent(id, { devServerStoppedAt: stoppedAt })
    deps.toast.error(copy.failureTitle, result.error || undefined)
  }
}

/**
 * **Dev Server Stop** (#1342) — stop the dev server and its bridge proxy,
 * leaving the Sandbox running and the output in place. Recorded on the Branch
 * first so every member's dot goes quiet at once and a reconnect doesn't
 * relaunch it; cleared again if the stop fails.
 */
export async function stopDevServer(
  id: string,
  deps: BranchRecoveryDeps,
  now: number = Date.now()
): Promise<void> {
  const agent = deps.findAgent(id)
  if (!agent?.sandboxName) return
  deps.patchAgent(id, { devServerStoppedAt: now })
  const result = await stopDevServerSandbox(agent.sandboxName).catch(
    (err: unknown) => ({
      success: false as const,
      error: err instanceof Error ? err.message : String(err),
    })
  )
  if (!result.success) {
    deps.patchAgent(id, { devServerStoppedAt: undefined })
    deps.toast.error("Couldn’t stop preview", result.error || undefined)
  }
}

/**
 * **Sandbox Restart** — snapshot-restore onto a fresh VM, preserving the
 * working tree (uncommitted changes included). Fails loud on a snapshot miss
 * rather than recloning — the error rides through as the `error` status + toast
 * so the user can fall back to Recreate (ADR 0005).
 */
export function restartSandbox(
  id: string,
  deps: BranchRecoveryDeps
): Promise<RecoveryOutcome> {
  return runSandboxRecovery(
    id,
    {
      startingMessage: "Starting preview…",
      successMessage: "Preview started",
      failureTitle: "Couldn’t start preview",
      run: (agent, repo, id) =>
        restartSandboxVm(agent.sandboxName, repo, {
          roomId: deps.roomId,
          branchId: id,
        }),
    },
    deps
  )
}

/**
 * **Recreate** — the explicit, confirm-gated, destructive reclone from git.
 * Discards the in-VM working tree, so the UI gates it behind a confirm before
 * calling here (this module trusts that gate; it does not re-prompt).
 */
export function recreate(
  id: string,
  deps: BranchRecoveryDeps
): Promise<RecoveryOutcome> {
  return runSandboxRecovery(
    id,
    {
      startingMessage: "Setting up the code again…",
      successMessage: "Code set up again",
      failureTitle: "Couldn’t set up the code again",
      run: (agent, repo) =>
        recreateSandbox(agent.sandboxName, repo, agent.ref, deps.roomId, id),
    },
    deps
  )
}

/**
 * **Workspace Start** — what a frame's Retry (on a failed Workspace) and Start
 * (on a stopped one) run (issue #731). It goes through the status-flipping
 * runner, unlike the bare Dev Server Restart, so the frame follows the Workspace
 * from `starting` to `running`, or back to `error` with the new reason.
 *
 * Hosted, it is Sandbox Restart. The local build has no VM to restore, so
 * there it restarts the dev server in the existing worktree. Either way it's
 * the frame's Start, so its copy says so ("Starting preview…").
 */
export function startWorkspace(
  id: string,
  deps: BranchRecoveryDeps,
  { local }: { local: boolean }
): Promise<RecoveryOutcome> {
  if (!local) return restartSandbox(id, deps)
  return runSandboxRecovery(
    id,
    {
      startingMessage: "Starting preview…",
      successMessage: "Preview started",
      failureTitle: "Couldn’t start preview",
      codeReadyAtStart: true,
      run: async (agent, repo) => {
        const result = await restartDevServerSandbox(agent.sandboxName, repo)
        if (!result.success) return result
        return {
          success: true,
          value: {
            sandboxName: agent.sandboxName,
            previewDomain: result.value.previewDomain,
          },
        }
      },
    },
    deps
  )
}

/**
 * **Mark as done** (#976) — the member is finished with the Workspace. It is
 * Done at once (its frames leave the Canvas and its row moves to the sidebar's
 * Done section, for every member), then its dev server spins down. The stop is
 * best-effort: a sandbox that's already gone is as stopped as it gets, and
 * Reopen relaunches whatever is left. Chats and history are untouched.
 */
export async function markDone(
  id: string,
  deps: BranchRecoveryDeps,
  now: number = Date.now()
): Promise<void> {
  const agent = deps.findAgent(id)
  if (!agent) return
  deps.patchAgent(id, {
    doneAt: now,
    status: "stopped",
    statusMessage: "",
    error: "",
  })
  if (!agent.sandboxName) return
  await stopWorkspaceSandbox(agent.sandboxName).catch(() => undefined)
}

/**
 * **Reopen** (#976) — undo Mark as done: the Workspace leaves the Done section,
 * its frames come back where they were, and its sandbox starts again through
 * the reconnect path (resume a hibernated VM, relaunch the dev server), shown
 * as `starting` until it runs.
 */
export function reopen(
  id: string,
  deps: BranchRecoveryDeps
): Promise<RecoveryOutcome> {
  if (!deps.findAgent(id)) return Promise.resolve({ ok: true })
  deps.patchAgent(id, { doneAt: undefined })
  return runSandboxRecovery(
    id,
    {
      startingMessage: "Starting…",
      failureTitle: "Couldn’t reopen chat",
      run: (agent, repo) => reconnectSandbox(agent.sandboxName, repo),
    },
    deps
  )
}
