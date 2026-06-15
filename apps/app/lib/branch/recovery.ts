import {
  recreateSandbox,
  restartDevServer as restartDevServerSandbox,
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
}

/**
 * The fields the runner patches onto the Branch record. A subset of
 * `Partial<BranchData>`, so the real `updateAgentInStorage` is a drop-in.
 */
export interface RecoveryPatch {
  sandboxName?: string
  previewDomain?: string
  status?: "starting" | "running" | "error"
  statusMessage?: string
  error?: string
}

/** Surface success / failure to the user. Adapts the sonner `toast` at the call site. */
export interface RecoveryToasts {
  success: (message: string) => void
  error: (message: string, description?: string) => void
}

/** The injected seams every recovery verb runs over. */
export interface BranchRecoveryDeps {
  /** Look up the Branch being recovered. Missing → the verb is a silent no-op
   *  (the Branch vanished out from under the menu before the click landed). */
  findAgent: (id: string) => RecoveryAgent | undefined
  /** Look up the Repo backing the Branch. Missing → the verb reports an error. */
  findRepo: (repoId: string) => RepoData | undefined
  /** Patch the Branch record (the agent-store seam). */
  patchAgent: (id: string, patch: RecoveryPatch) => void
  toast: RecoveryToasts
}

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
  /** Toast on success ("Sandbox restarted"). */
  successMessage: string
  /** Toast title on failure / a missing repo ("Couldn't restart sandbox"). */
  failureTitle: string
  /** The sandbox fn to await — bound to restartSandbox / recreateSandbox. */
  run: (agent: RecoveryAgent, repo: RepoData) => Promise<SandboxRecoveryResult>
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
): Promise<void> {
  const agent = deps.findAgent(id)
  if (!agent?.sandboxName) return

  const repo = deps.findRepo(agent.repoId)
  if (!repo) {
    deps.patchAgent(id, { status: "error", error: "Workspace not found" })
    deps.toast.error(spec.failureTitle, "Workspace not found")
    return
  }

  deps.patchAgent(id, {
    status: "starting",
    statusMessage: spec.startingMessage,
  })

  const result = await spec.run(agent, repo)
  if (result.success) {
    deps.patchAgent(id, {
      sandboxName: result.value.sandboxName,
      // A new VM may report the same preview port; fall back to the old domain
      // so a blank value never wipes a working preview.
      previewDomain: result.value.previewDomain || agent.previewDomain,
      status: "running",
      statusMessage: "",
      error: "",
    })
    deps.toast.success(spec.successMessage)
  } else {
    deps.patchAgent(id, {
      status: "error",
      statusMessage: "",
      error: result.error || "",
    })
    deps.toast.error(spec.failureTitle, result.error || undefined)
  }
}

/**
 * **Dev Server Restart** — bounce the dev server inside an already-running
 * Sandbox. The thin path: no VM cycle and no status flip, so it stays usable
 * mid-turn while the agent works, and a blank preview port means there's
 * nothing to persist — the only signal is a toast. A missing Repo is reported
 * without flipping status (there's no status to flip on this path).
 */
export async function restartDevServer(
  id: string,
  deps: BranchRecoveryDeps
): Promise<void> {
  const agent = deps.findAgent(id)
  if (!agent?.sandboxName) return

  const repo = deps.findRepo(agent.repoId)
  if (!repo) {
    deps.toast.error("Couldn't restart dev server", "Workspace not found")
    return
  }

  const result = await restartDevServerSandbox(agent.sandboxName, repo)
  if (result.success) {
    deps.toast.success("Dev server restarted")
  } else {
    deps.toast.error("Couldn't restart dev server", result.error || undefined)
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
): Promise<void> {
  return runSandboxRecovery(
    id,
    {
      startingMessage: "Restarting sandbox…",
      successMessage: "Sandbox restarted",
      failureTitle: "Couldn't restart sandbox",
      run: (agent, repo) => restartSandboxVm(agent.sandboxName, repo),
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
): Promise<void> {
  return runSandboxRecovery(
    id,
    {
      startingMessage: "Recreating sandbox…",
      successMessage: "Sandbox recreated",
      failureTitle: "Couldn't recreate sandbox",
      run: (agent, repo) => recreateSandbox(agent.sandboxName, repo, agent.ref),
    },
    deps
  )
}
