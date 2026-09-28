import type { BranchData } from "@/lib/types"

/**
 * Workspace status line — the words behind each Workspace row's status icon
 * in the in-room sidebar (#791), shown in its tooltip. It says what the
 * Workspace is doing right now: the setup step it's on, that its agent is
 * working, where its PR stands, or that setup failed.
 *
 * Pure: it reads the slice of a Branch below plus two facts the sidebar
 * already holds (whether a turn is in flight, the cached PR), and returns plain
 * values, so `status-line.test.ts` asserts it with no React.
 */

/** The slice of a Branch the status line reads. {@link BranchData} satisfies it. */
export type StatusLineBranch = Pick<
  BranchData,
  "status" | "statusMessage" | "error"
>

export interface StatusLineContext {
  /** A chat turn is in flight on this Workspace. */
  agentWorking: boolean
  pr?: { number: number; state: "open" | "closed" | "merged" }
}

export type WorkspaceStatusLine =
  /** Provisioning or recovering. `step` is the current step, without the
   *  trailing ellipsis; the row appends the elapsed time. */
  | { kind: "progress"; step: string }
  /** Setup (or a recovery) failed. `title` names what failed, for the detail
   *  card; `detail` is the raw error. */
  | { kind: "error"; title: string; detail: string }
  | { kind: "idle"; text: string }

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
  if (branch.status === "stopped") return { kind: "idle", text: "Stopped" }
  if (ctx.agentWorking) return { kind: "idle", text: "Agent working" }
  if (ctx.pr) {
    return { kind: "idle", text: `PR #${ctx.pr.number} · ${ctx.pr.state}` }
  }
  return { kind: "idle", text: "Ready" }
}

/** Elapsed time for a progress step: "8s", "40s", "2m 05s". */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  if (total < 60) return `${total}s`
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}m ${String(s).padStart(2, "0")}s`
}
