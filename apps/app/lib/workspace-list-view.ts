/**
 * Workspaces list view (#885) — how one member sees the Workspaces list in
 * the chat panel's Workspaces menu (#1152): its sort (manual drag order,
 * recent activity, or name) and whether it is grouped into state sections. A
 * local view preference: it lives in this browser's storage, keyed by user and
 * canvas, and never enters the room doc, so collaborators' lists don't move.
 *
 * Pure apart from the storage helpers at the bottom, so the ordering and
 * section rules are tested with no React (`workspace-list-view.test.ts`).
 */
import {
  workspaceStatusLine,
  type StatusLineBranch,
  type StatusLineContext,
} from "@/lib/branch/status-line"
import type { BranchData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"

export type WorkspaceSort = "manual" | "recent" | "name"

/** The live state sections of a grouped list. Done keeps its own section. */
export type WorkspaceSection = "working" | "needs-you" | "idle"

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

export const WORKSPACE_SORT_LABELS: Record<WorkspaceSort, string> = {
  manual: "Manual",
  recent: "Recent activity",
  name: "Name",
}

export interface WorkspaceListView {
  sort: WorkspaceSort
  groupByState: boolean
}

/** A list never touched: manual order, ungrouped, as before #885. */
export const DEFAULT_WORKSPACE_LIST_VIEW: WorkspaceListView = {
  sort: "manual",
  groupByState: false,
}

/** Drag reorder writes manual order, so it only makes sense where rows show it. */
export function canDragWorkspaces(view: WorkspaceListView): boolean {
  return view.sort === "manual" && !view.groupByState
}

export type SectionBranch = StatusLineBranch

export type SectionContext = StatusLineContext

/**
 * Which live section a (not Done) Workspace sits in, from the same state its
 * row icon shows: an agent working or setup running is Working; a failed
 * setup, a plan waiting for approval or a blocked PR is Needs you; anything
 * else, an open PR waiting on review included, is Idle.
 */
export function workspaceSection(
  branch: SectionBranch,
  ctx: SectionContext
): WorkspaceSection {
  const line = workspaceStatusLine(branch, ctx)
  if (line.kind === "progress") return "working"
  if (line.kind === "error") return "needs-you"
  if (line.state === "working") return "working"
  return line.state === "needs-you" ? "needs-you" : "idle"
}

/**
 * Whether any Workspace needs the member (#1152): at least one that isn't Done
 * falls in the Needs you section, by the same rule that files it there. It
 * drives the dot on the chat panel's Workspaces button.
 */
export function anyWorkspaceNeedsYou<T extends SectionBranch>(
  branches: readonly T[],
  context: (branch: T) => SectionContext
): boolean {
  return branches.some(
    (b) => !b.doneAt && workspaceSection(b, context(b)) === "needs-you"
  )
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
 * `branches` (already in manual order) in the view's sort. Stable, so ties
 * keep manual order; non-mutating.
 */
export function sortWorkspaces<T extends SortBranch>(
  branches: readonly T[],
  sort: WorkspaceSort
): T[] {
  if (sort === "manual") return [...branches]
  if (sort === "recent")
    return [...branches].sort((a, b) => lastActivity(b) - lastActivity(a))
  return [...branches].sort((a, b) =>
    workspaceLabel(a).localeCompare(workspaceLabel(b), undefined, {
      sensitivity: "base",
      numeric: true,
    })
  )
}

/**
 * The grouped list: each live section with its Workspaces in the view's sort,
 * empty sections left out. Pass only Workspaces that aren't Done.
 */
export function groupWorkspaces<T extends SortBranch & SectionBranch>(
  branches: readonly T[],
  sort: WorkspaceSort,
  context: (branch: T) => SectionContext
): { section: WorkspaceSection; branches: T[] }[] {
  const sorted = sortWorkspaces(branches, sort)
  return WORKSPACE_SECTIONS.map((section) => ({
    section,
    branches: sorted.filter((b) => workspaceSection(b, context(b)) === section),
  })).filter((g) => g.branches.length > 0)
}

// --- Storage: per user, per canvas, this browser only ---

const STORAGE_PREFIX = "workspace-list-view"

export function workspaceListViewKey(userId: string, roomId: string): string {
  return `${STORAGE_PREFIX}:${userId}:${roomId}`
}

const SORTS: readonly WorkspaceSort[] = ["manual", "recent", "name"]

/** A stored view, with anything missing or unknown back at its default. */
export function parseWorkspaceListView(
  raw: string | null | undefined
): WorkspaceListView {
  if (!raw) return DEFAULT_WORKSPACE_LIST_VIEW
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return DEFAULT_WORKSPACE_LIST_VIEW
  }
  if (!value || typeof value !== "object") return DEFAULT_WORKSPACE_LIST_VIEW
  const v = value as Record<string, unknown>
  return {
    sort: SORTS.includes(v.sort as WorkspaceSort)
      ? (v.sort as WorkspaceSort)
      : DEFAULT_WORKSPACE_LIST_VIEW.sort,
    groupByState: v.groupByState === true,
  }
}

export function readWorkspaceListView(
  userId: string,
  roomId: string
): WorkspaceListView {
  if (typeof window === "undefined") return DEFAULT_WORKSPACE_LIST_VIEW
  try {
    return parseWorkspaceListView(
      window.localStorage.getItem(workspaceListViewKey(userId, roomId))
    )
  } catch {
    return DEFAULT_WORKSPACE_LIST_VIEW
  }
}

export function writeWorkspaceListView(
  userId: string,
  roomId: string,
  view: WorkspaceListView
): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(
      workspaceListViewKey(userId, roomId),
      JSON.stringify(view)
    )
  } catch {}
}
