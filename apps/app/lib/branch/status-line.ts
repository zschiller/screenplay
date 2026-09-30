import type { BranchData, PlanData } from "@/lib/types"

/**
 * Workspace status line — the words behind each Workspace row's status icon
 * in the in-room sidebar (#791), shown in its tooltip. It says what the
 * Workspace is doing right now: the setup step it's on, that its agent is
 * working, that it needs you, that it's ready, stopped or Done (#976), or that
 * setup failed. Its PR is not a state: the row shows it at its end (#963),
 * except that a PR which can't merge needs you.
 *
 * Needs you means the person has to act: a plan waiting for approval, a PR
 * whose merge is blocked, or (as the error line) a failed setup. An open,
 * healthy PR waits on its reviewers, so it's Ready.
 *
 * Pure: it reads the slice of a Branch below plus two facts from the room doc
 * (whether a turn is in flight, whether a plan waits), and returns plain
 * values, so `status-line.test.ts` asserts it with no React.
 */

/** The slice of a Branch the status line reads. {@link BranchData} satisfies it. */
export type StatusLineBranch = Pick<
  BranchData,
  "status" | "statusMessage" | "error" | "doneAt" | "prState" | "prBlocked"
>

export interface StatusLineContext {
  /** A chat turn is in flight on this Workspace. */
  agentWorking: boolean
  /** One of this Workspace's plans waits for approval. */
  planPending?: boolean
}

export type WorkspaceStatusLine =
  /** Provisioning or recovering. `step` is the current step, without the
   *  trailing ellipsis; the row appends the elapsed time. */
  | { kind: "progress"; step: string }
  /** Setup (or a recovery) failed. `title` names what failed, for the detail
   *  card; `detail` is the raw error. */
  | { kind: "error"; title: string; detail: string }
  | {
      kind: "idle"
      state: "working" | "needs-you" | "ready" | "stopped" | "done"
      text: string
    }

/** "Installing dependencies…" → "Installing dependencies". */
function stepLabel(message: string | undefined): string {
  return (message ?? "")
    .trim()
    .replace(/(…|\.\.\.)$/, "")
    .trim()
}

/**
 * What failed, for the detail card's title. The server keeps the step that was
 * running when it wrote the error, so a failed install reads "Installing
 * dependencies failed"; with no step on record it falls back to "Setup failed".
 */
export function failureTitle(message: string | undefined): string {
  const step = stepLabel(message)
  return step ? `${step} failed` : "Setup failed"
}

export function workspaceStatusLine(
  branch: StatusLineBranch,
  ctx: StatusLineContext
): WorkspaceStatusLine {
  // Done is the member's word on the Workspace, so it wins over the sandbox.
  if (branch.doneAt) return { kind: "idle", state: "done", text: "Done" }
  if (branch.status === "error" || branch.error) {
    return {
      kind: "error",
      title: failureTitle(branch.statusMessage),
      detail: branch.error || "Unknown error",
    }
  }
  if (branch.status === "creating" || branch.status === "starting") {
    return {
      kind: "progress",
      step:
        stepLabel(branch.statusMessage) ||
        (branch.status === "creating" ? "Creating workspace" : "Starting"),
    }
  }
  const needsYou: WorkspaceStatusLine | null = ctx.planPending
    ? { kind: "idle", state: "needs-you", text: "Plan waiting for approval" }
    : branch.prState === "open" && branch.prBlocked
      ? { kind: "idle", state: "needs-you", text: "Merge blocked" }
      : null
  // A stopped sandbox still waits on the person for its plan or its PR.
  if (branch.status === "stopped")
    return needsYou ?? { kind: "idle", state: "stopped", text: "Stopped" }
  if (ctx.agentWorking)
    return { kind: "idle", state: "working", text: "Agent working" }
  if (needsYou) return needsYou
  return { kind: "idle", state: "ready", text: "Ready" }
}

/** The Workspaces with a plan waiting for approval, from the room's plans. */
export function planPendingBranchIds(
  plans: readonly Pick<PlanData, "branchId" | "status">[]
): Set<string> {
  return new Set(
    plans.filter((p) => p.status === "pending").map((p) => p.branchId)
  )
}

/** Elapsed time for a progress step: "8s", "40s", "2m 05s". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}m ${String(s).padStart(2, "0")}s`
}
