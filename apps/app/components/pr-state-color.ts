import type { BranchPrInfo } from "@/lib/github-actions"

/**
 * GitHub's PR state colours (open = green, merged = purple, closed = red),
 * shared by the sidebar's Workspace icon and the chat panel's PR button so the
 * two stay legible together.
 */
export function prStateColor(state: BranchPrInfo["state"]): string {
  return state === "merged"
    ? "text-purple-600 dark:text-purple-400"
    : state === "closed"
      ? "text-red-600 dark:text-red-400"
      : "text-green-700 dark:text-green-300"
}
