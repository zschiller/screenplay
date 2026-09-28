import type { BranchData } from "@/lib/types"

/**
 * The one label rule for a Workspace (#881): its title, falling back to its
 * branch name when it has none. Workspaces created before titles existed have
 * no `title`; an empty or blank one counts as missing.
 */
export function workspaceLabel(
  workspace: Pick<BranchData, "title" | "ref">
): string {
  const title = workspace.title?.trim()
  return title ? title : workspace.ref
}

/** Whether {@link workspaceLabel} resolves to a title rather than the branch. */
export function hasWorkspaceTitle(
  workspace: Pick<BranchData, "title">
): boolean {
  return !!workspace.title?.trim()
}
