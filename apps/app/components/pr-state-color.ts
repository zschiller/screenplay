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

/**
 * {@link prStateColor} for a Button: the stock variants' hover sets the text to
 * the foreground colour, so the hover repeats the state colour to keep it.
 */
export function prStateButtonColor(state: BranchPrInfo["state"]): string {
  return state === "merged"
    ? "text-merged hover:text-merged"
    : state === "closed"
      ? "text-destructive hover:text-destructive"
      : "text-success hover:text-success"
}
