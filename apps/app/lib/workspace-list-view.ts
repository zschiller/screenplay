/**
 * Workspaces list view (#885) — how one member sees the Workspaces list in
 * the chat panel's Chats menu (#1152): its sort (recent activity or name)
 * inside the state sections the list is always grouped into. A local view
 * preference: it lives in this browser's storage, keyed by user and
 * canvas, and never enters the room doc, so collaborators' lists don't move.
 *
 * Which section a Workspace sits in is its Workspace State's call
 * (`lib/branch/workspace-state.ts`); this module only orders the list.
 *
 * Pure apart from the storage helpers at the bottom, so the ordering is
 * tested with no React (`workspace-list-view.test.ts`).
 */
import type { WorkspaceSection } from "@/lib/branch/workspace-state"
import type { BranchData } from "@/lib/types"
import { workspaceLabel } from "@/lib/workspace-label"

export type WorkspaceSort = "recent" | "name"

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

export const WORKSPACE_SORT_LABELS: Record<WorkspaceSort, string> = {
  recent: "Recent activity",
  name: "Name",
}

export interface WorkspaceListView {
  sort: WorkspaceSort
}

/** A list never touched: most recent activity first. */
export const DEFAULT_WORKSPACE_LIST_VIEW: WorkspaceListView = {
  sort: "recent",
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
 * `branches` (already in sidebar order) in the view's sort. Stable, so ties
 * keep that order; non-mutating.
 */
export function sortWorkspaces<T extends SortBranch>(
  branches: readonly T[],
  sort: WorkspaceSort
): T[] {
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
export function groupWorkspaces<T extends SortBranch>(
  branches: readonly T[],
  sort: WorkspaceSort,
  sectionOf: (branch: T) => WorkspaceSection | "done"
): { section: WorkspaceSection; branches: T[] }[] {
  const sorted = sortWorkspaces(branches, sort)
  return WORKSPACE_SECTIONS.map((section) => ({
    section,
    branches: sorted.filter((b) => sectionOf(b) === section),
  })).filter((g) => g.branches.length > 0)
}

// --- Storage: per user, per canvas, this browser only ---

const STORAGE_PREFIX = "workspace-list-view"

export function workspaceListViewKey(userId: string, roomId: string): string {
  return `${STORAGE_PREFIX}:${userId}:${roomId}`
}

const SORTS: readonly WorkspaceSort[] = ["recent", "name"]

/**
 * A stored view, with anything missing or unknown back at its default
 * (including views from before the list was always grouped: `manual` sort,
 * `groupByState`).
 */
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
