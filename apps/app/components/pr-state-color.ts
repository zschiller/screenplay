import type { BranchPrInfo } from "@/lib/github-actions"

/**
 * GitHub's PR state colours (open = green, merged = purple, closed = red) as
 * the status ink tokens, shared by the sidebar's Workspace icon and the chat panel's PR button so the
 * two stay legible together.
 */
export function prStateColor(state: BranchPrInfo["state"]): string {
  return state === "merged"
    ? "text-merged"
    : state === "closed"
      ? "text-destructive"
      : "text-success"
}

/** The same hue a shade calmer, for a PR badge's number beside its glyph. */
export function prStateTextColor(state: BranchPrInfo["state"]): string {
  return state === "merged"
    ? "text-merged-text"
    : state === "closed"
      ? "text-destructive-text"
      : "text-success-text"
}
