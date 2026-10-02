import { repoShortName, type RepoNaming } from "@/lib/repo-identity"
import type { BranchData } from "@/lib/types"

/** The Workspace fields that say whether it has had a turn. */
export type FreshnessFields = Pick<
  BranchData,
  | "title"
  | "lastActivityAt"
  | "doneAt"
  | "pendingSeed"
  | "prNumber"
  | "diffAdditions"
  | "diffDeletions"
  | "createFlow"
  | "autoNamedBranch"
>

/**
 * A fresh Workspace (#1182): a new branch whose chats have had no turn yet,
 * like the one adding a repository starts. The Coordinator sends the next ask
 * that fits its repository there rather than planning a new Workspace, and the
 * Coordinator's empty chat reads for a new canvas while every Workspace is.
 *
 * A turn stamps `lastActivityAt` and names an auto-named Workspace, so either
 * one rules it out. So do the traces of work older Workspaces may carry without
 * those stamps (a PR, changed lines), a pinned name, a seed message waiting,
 * being done, or having been opened from an existing branch.
 */
export function isFreshWorkspace(branch: FreshnessFields): boolean {
  return (
    !branch.lastActivityAt &&
    !branch.title?.trim() &&
    !branch.doneAt &&
    !branch.pendingSeed &&
    !branch.prNumber &&
    !branch.diffAdditions &&
    !branch.diffDeletions &&
    (branch.createFlow ?? "new") === "new" &&
    branch.autoNamedBranch !== false
  )
}

/** How the Coordinator's empty chat reads. */
export type CoordinatorStart =
  | {
      kind: "fresh"
      /** The canvas's one repository, named in the title; none with several. */
      repoName?: string
    }
  | { kind: "busy" }
  /** No repository yet: the Coordinator makes Mockups and Documents itself. */
  | { kind: "no-repository" }

/**
 * Which empty state the Coordinator shows (#1182): a canvas with no repository
 * offers Mockups and Documents, which it makes itself; a fresh canvas (at
 * least one repository, a fresh Workspace on it, and no Workspace that has had
 * a turn) asks what should change; any other canvas asks about the canvas.
 */
export function coordinatorStart({
  repos,
  branches,
}: {
  repos: readonly RepoNaming[]
  branches: readonly FreshnessFields[]
}): CoordinatorStart {
  if (repos.length === 0) return { kind: "no-repository" }
  if (branches.length === 0 || !branches.every(isFreshWorkspace)) {
    return { kind: "busy" }
  }
  return repos.length === 1
    ? { kind: "fresh", repoName: repoShortName(repos[0]!) }
    : { kind: "fresh" }
}
