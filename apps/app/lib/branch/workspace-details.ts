import { repoSource, type RepoNaming } from "@/lib/repo-identity"
import type { BranchData } from "@/lib/types"

/**
 * The git details a Workspace's hover card lists under its title and status
 * (#882): where it lives, its branch, the branch its changes are measured
 * against, and the line counts. Everything comes from what the Workspace
 * already caches in the room doc; a field it can't fill yet is left out.
 */
export interface WorkspaceDetails {
  /** The Repo's `owner/name`, or its folder on disk when it has no remote. */
  repository?: string
  branch?: string
  /** The Repo's default branch, which the line counts compare against. */
  base?: string
  changes?: { additions: number; deletions: number }
}

export type WorkspaceDetailsBranch = Pick<
  BranchData,
  "ref" | "status" | "diffAdditions" | "diffDeletions"
>

export type WorkspaceDetailsRepo = RepoNaming & { defaultBranch: string }

export function workspaceDetails(
  branch: WorkspaceDetailsBranch,
  repo: WorkspaceDetailsRepo | undefined
): WorkspaceDetails {
  const details: WorkspaceDetails = {}
  if (repo) details.repository = repo.repoFullName || repoSource(repo)
  if (branch.ref) details.branch = branch.ref
  // A Workspace on the default branch itself has nothing to compare against.
  const base = repo?.defaultBranch
  if (!base || branch.ref === base) return details
  details.base = base
  // The same rule as the sidebar's line count: only a running Workspace's
  // cache is current.
  if (
    branch.status === "running" &&
    typeof branch.diffAdditions === "number" &&
    typeof branch.diffDeletions === "number"
  ) {
    details.changes = {
      additions: branch.diffAdditions,
      deletions: branch.diffDeletions,
    }
  }
  return details
}
