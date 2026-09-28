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

/**
 * The chat header's PR status dot: merged and closed take their GitHub colour;
 * an open PR shows its checks (failing red, pending amber, else open green).
 */
export function prStatusDotColor(
  state: BranchPrInfo["state"],
  checks?: BranchPrInfo["checks"]
): string {
  if (state === "merged") return "bg-purple-600 dark:bg-purple-400"
  if (state === "closed" || checks === "failing")
    return "bg-red-600 dark:bg-red-400"
  if (checks === "pending") return "bg-amber-500 dark:bg-amber-400"
  return "bg-green-600 dark:bg-green-400"
}

/** One line naming a PR's state and, when open, its checks ("Open · checks passing"). */
export function prStatusLabel(
  state: BranchPrInfo["state"],
  checks?: BranchPrInfo["checks"]
): string {
  if (state === "merged") return "Merged"
  if (state === "closed") return "Closed"
  return checks ? `Open · checks ${checks}` : "Open"
}
