import { isBranchBusy, type BranchBusyChat } from "@/lib/branch-busy"
import {
  planPendingBranchIds,
  workspaceStatusLine,
  type StatusLineBranch,
  type WorkspaceStatusLine,
} from "@/lib/branch/status-line"
import type { BranchData, PlanData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"
import {
  workspaceSection,
  type WorkspaceSection,
} from "@/lib/workspace-list-view"

/**
 * Workspace State (#1247): everything a Workspace shows about itself, worked
 * out once from its Branch and the Room's Chat Sessions and plans. Its label,
 * its status line (the words and glyph behind its state icon), the Workspaces
 * menu section it sits in, and whether it needs you. Mentions, the hover card
 * and the Getting started checklist read it, so a Workspace reads the same
 * everywhere; callers never build the facts themselves.
 *
 * Pure, so `workspace-state.test.ts` asserts it from fixtures with no React.
 * `useWorkspaceStates` is the hook that feeds it the Room doc.
 */

/** The slice of a Branch Workspace State reads. {@link BranchData} satisfies it. */
export type WorkspaceStateBranch = StatusLineBranch &
  Pick<BranchData, "id" | "title">

export interface WorkspaceState {
  /** Its name: the title, or "New Workspace". */
  label: string
  line: WorkspaceStatusLine
  /** Its Workspaces menu section; Done keeps its own. */
  section: WorkspaceSection | "done"
  /** A plan to approve, a blocked merge or a failed setup waits on you. */
  needsYou: boolean
}

/**
 * The Room's facts about its Workspaces, read from its Chat Sessions and
 * plans in one pass: which have a turn in flight and which have a plan
 * waiting for approval.
 */
export interface RoomWorkspaceFacts {
  busy: ReadonlySet<string>
  planPending: ReadonlySet<string>
}

export function roomWorkspaceFacts(
  chats: readonly BranchBusyChat[],
  plans: readonly Pick<PlanData, "branchId" | "status">[]
): RoomWorkspaceFacts {
  const busy = new Set<string>()
  for (const chat of chats) {
    if (chat.branchId && isBranchBusy(chat.branchId, [chat]))
      busy.add(chat.branchId)
  }
  return { busy, planPending: planPendingBranchIds(plans) }
}

export function workspaceState(
  branch: WorkspaceStateBranch,
  room: RoomWorkspaceFacts
): WorkspaceState {
  const context = {
    agentWorking: room.busy.has(branch.id),
    planPending: room.planPending.has(branch.id),
  }
  const section = branch.doneAt ? "done" : workspaceSection(branch, context)
  return {
    label: workspaceLabel(branch),
    line: workspaceStatusLine(branch, context),
    section,
    needsYou: section === "needs-you",
  }
}
