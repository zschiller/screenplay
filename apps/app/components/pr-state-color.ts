import type { BranchPrInfo } from "@/lib/github-actions"

/**
 * A PR as the UI draws it: GitHub's state, or `blocked` for an open PR that
 * can't merge (failing checks, a conflict), which reads as closed's red with
 * the merge-conflict glyph.
 */
export function shownPrState(
  state: BranchPrInfo["state"],
  blocked?: boolean
): BranchPrInfo["state"] | "blocked" {
  return state === "open" && blocked ? "blocked" : state
}

/**
 * GitHub's PR state colours (open = green, merged = purple, closed and merge
 * blocked = red) as the status ink tokens, shared by the sidebar's Workspace
 * icon and the chat panel's PR button so the two stay legible together.
 */
export function prStateColor(
  state: BranchPrInfo["state"],
  blocked?: boolean
): string {
  const shown = shownPrState(state, blocked)
  return shown === "merged"
    ? "text-merged"
    : shown === "open"
      ? "text-success"
      : "text-destructive"
}

/**
 * {@link prStateColor} for a Button: the stock variants' hover sets the text to
 * the foreground colour, so the hover repeats the state colour to keep it.
 */
export function prStateButtonColor(
  state: BranchPrInfo["state"],
  blocked?: boolean
): string {
  const shown = shownPrState(state, blocked)
  return shown === "merged"
    ? "text-merged hover:text-merged"
    : shown === "open"
      ? "text-success hover:text-success"
      : "text-destructive hover:text-destructive"
}
