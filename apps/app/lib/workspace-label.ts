import type { BranchData } from "@/lib/types"

/** What a Workspace without a title reads as (#1182): never its branch. */
export const UNTITLED_WORKSPACE_LABEL = "New chat"

/**
 * The one label rule for a Workspace (#881): its title, falling back to "New
 * Workspace" when it has none (#1182), so the UI never shows a branch as a
 * Workspace's name. A Workspace takes its title from its first turn; one
 * created before titles existed has none. An empty or blank title counts as
 * missing.
 */
export function workspaceLabel(workspace: Pick<BranchData, "title">): string {
  const title = workspace.title?.trim()
  return title ? title : UNTITLED_WORKSPACE_LABEL
}
