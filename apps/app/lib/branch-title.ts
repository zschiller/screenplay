import type { BranchData } from "@/lib/types"

/**
 * The human title a Workspace (Branch) is shown by: its stored `title` when it
 * has one, otherwise a readable form of its git ref (`fix-login-button` →
 * "Fix login button"), so Branches created before titles existed, or opened
 * bare from a remote branch, still read as words rather than a slug.
 */
export function branchTitle(branch: Pick<BranchData, "title" | "ref">): string {
  const stored = branch.title?.trim()
  if (stored) return stored
  return humanizeRef(branch.ref)
}

/** `claude/fix-login_button` → "Fix login button". Empty in, empty out. */
export function humanizeRef(ref: string): string {
  const last = ref.split("/").filter(Boolean).pop() ?? ""
  const words = last
    .replace(/[-_.]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!words) return ref
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** Normalize a user-typed title: collapse whitespace, cap the length. */
export function sanitizeBranchTitle(next: string): string {
  return next.replace(/\s+/g, " ").trim().slice(0, 80)
}
