/**
 * The rules for renaming a Workspace's git branch (Rename branch in the
 * Workspace menu's Git group, #881). Pure, so the sidebar's dialog and its
 * tests share one check.
 */

/**
 * Lowercase and hyphenate a typed name (or a model's suggestion) into a
 * git-safe branch name. The one ref sanitizer (#910).
 */
export function sanitizeBranchName(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9/_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
}

export type BranchRenameCheck =
  | { kind: "rename"; branch: string }
  | { kind: "unchanged" }
  | { kind: "invalid" }

/**
 * Check a typed branch name against the Workspace's current branch. Renaming
 * onto a branch that already exists on the remote would hijack its history, so
 * that's always blocked. `otherLocalRefs` are refs other open Workspaces hold;
 * on the desktop build the local backend keeps one checkout per ref
 * (worktrees, ADR 0009), so the caller passes them there and an empty list on
 * hosted.
 */
export function checkBranchRename(opts: {
  next: string
  current: string
  remoteBranches?: ReadonlySet<string>
  otherLocalRefs?: readonly string[]
}): BranchRenameCheck {
  const branch = sanitizeBranchName(opts.next)
  if (!branch) return { kind: "invalid" }
  if (branch === opts.current) return { kind: "unchanged" }
  if (opts.remoteBranches?.has(branch)) return { kind: "invalid" }
  if (opts.otherLocalRefs?.includes(branch)) return { kind: "invalid" }
  return { kind: "rename", branch }
}
