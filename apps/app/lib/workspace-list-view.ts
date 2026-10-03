/**
 * Workspaces list order (#885) — how the chat panel's Chats menu (#1152)
 * orders its Workspaces: grouped into state sections, most recent activity
 * first inside each. The list has no per-member view options; a member's
 * old stored sort (`workspace-list-view:*` in localStorage) is no longer read.
 *
 * Which section a Workspace sits in is its Workspace State's call
 * (`lib/branch/workspace-state.ts`); this module only orders the list.
 *
 * Pure, so the ordering is tested with no React (`workspace-list-view.test.ts`).
 */
import type { WorkspaceSection } from "@/lib/branch/workspace-state"
import type { BranchData } from "@/lib/types"

/** The live state sections of a grouped list, in order. Done keeps its own. */
export const WORKSPACE_SECTIONS: readonly WorkspaceSection[] = [
  "working",
  "needs-you",
  "idle",
]

export const WORKSPACE_SECTION_LABELS: Record<WorkspaceSection, string> = {
  working: "Working",
  "needs-you": "Needs you",
  idle: "Idle",
}

export type SortBranch = Pick<
  BranchData,
  "id" | "title" | "ref" | "createdAt" | "lastActivityAt"
>

/** When a Workspace last saw a chat turn start, else when it was created. */
export function lastActivity(branch: SortBranch): number {
  return branch.lastActivityAt ?? branch.createdAt
}

/**
 * `branches` (already in sidebar order), most recent activity first. Stable,
 * so ties keep that order; non-mutating.
 */
export function sortWorkspaces<T extends SortBranch>(
  branches: readonly T[]
): T[] {
  return [...branches].sort((a, b) => lastActivity(b) - lastActivity(a))
}

/**
 * The grouped list: each live section with its Workspaces most recent first,
 * empty sections left out. Pass only Workspaces that aren't Done.
 */
export function groupWorkspaces<T extends SortBranch>(
  branches: readonly T[],
  sectionOf: (branch: T) => WorkspaceSection | "done"
): { section: WorkspaceSection; branches: T[] }[] {
  const sorted = sortWorkspaces(branches)
  return WORKSPACE_SECTIONS.map((section) => ({
    section,
    branches: sorted.filter((b) => sectionOf(b) === section),
  })).filter((g) => g.branches.length > 0)
}
