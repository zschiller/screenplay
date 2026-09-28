/**
 * What a Workspace holds that git hasn't saved anywhere else, and what deleting
 * it would therefore lose (issue #776). The delete confirms read this to say
 * what goes and what stays, and to warn only when a warning is true.
 *
 * React-free and server-free: the query that fills an {@link UnsavedWork} runs
 * in the Sandbox (`getUnsavedWork` in `lib/sandbox/git`); everything here is a
 * plain function of it, asserted in `unsaved-work.test.ts`.
 */

/** A Workspace's git state, read from its Sandbox's checkout. */
export interface UnsavedWork {
  /** Whether `origin/<ref>` exists, i.e. the git branch was ever pushed. */
  onOrigin: boolean
  /**
   * Commits on HEAD that `origin/<ref>` doesn't have, or, for a branch that was
   * never pushed, commits past the default branch.
   */
  unpushedCommits: number
  /** Files `git status` reports as changed or untracked. */
  uncommittedFiles: number
}

/** The part of {@link UnsavedWork} that deleting the Workspace destroys. */
export interface LostWork {
  commits: number
  files: number
}

/**
 * What a delete destroys. Uncommitted files always go with the Sandbox. Unpushed
 * commits go too on the hosted backend, where the VM is the only copy; on the
 * local build the git branch lives on in the clone on this computer, so its
 * commits survive the worktree's removal.
 */
export function lostWork(
  work: UnsavedWork,
  { localBranchKept }: { localBranchKept: boolean }
): LostWork {
  return {
    commits: localBranchKept ? 0 : work.unpushedCommits,
    files: work.uncommittedFiles,
  }
}

export function hasLostWork(lost: LostWork): boolean {
  return lost.commits > 0 || lost.files > 0
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/**
 * The delete-workspace warning, or null when nothing would be lost:
 * "2 unpushed commits will be lost." Short enough for one line in the dialog.
 */
export function lostWorkWarning(lost: LostWork): string | null {
  const parts = [
    lost.commits > 0 &&
      plural(lost.commits, "unpushed commit", "unpushed commits"),
    lost.files > 0 &&
      plural(lost.files, "uncommitted file", "uncommitted files"),
  ].filter(Boolean)
  return parts.length > 0 ? `${parts.join(" and ")} will be lost.` : null
}

/**
 * The remove-project warning, summed across its Workspaces, or null when none
 * would lose anything: "Unpushed work in 2 workspaces will be lost."
 */
export function projectLostWorkWarning(losses: LostWork[]): string | null {
  const affected = losses.filter(hasLostWork)
  if (affected.length === 0) return null
  const where = plural(affected.length, "workspace", "workspaces")
  return affected.some((l) => l.commits > 0)
    ? `Unpushed work in ${where} will be lost.`
    : `Unsaved work in ${where} will be lost.`
}

/** A Workspace row's state chip in the remove-project list. */
export type WorkspaceStateChip =
  | { kind: "loading" }
  | { kind: "lost"; label: string }
  | { kind: "pr"; label: string }
  | { kind: "unpushed"; label: string }
  | { kind: "clean"; label: string }

/**
 * One chip per row, the most important fact first: work that would be lost,
 * then an open PR, then commits that are kept but unpushed, then Clean. An
 * unreadable checkout (`null`, e.g. a stopped Sandbox) claims nothing beyond
 * the PR, which the doc already knows.
 */
export function workspaceStateChip(
  work: UnsavedWork | null | undefined,
  pr: { number?: number; open: boolean },
  options: { localBranchKept: boolean }
): WorkspaceStateChip | null {
  if (work === undefined) return { kind: "loading" }
  if (work) {
    const lost = lostWork(work, options)
    if (lost.commits > 0) {
      return { kind: "lost", label: `${lost.commits} unpushed` }
    }
    if (lost.files > 0) {
      return { kind: "lost", label: `${lost.files} uncommitted` }
    }
  }
  if (pr.open && pr.number) return { kind: "pr", label: `PR #${pr.number}` }
  if (!work) return null
  if (work.unpushedCommits > 0) {
    return { kind: "unpushed", label: `${work.unpushedCommits} unpushed` }
  }
  return { kind: "clean", label: "Clean" }
}
