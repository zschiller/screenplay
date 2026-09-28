/** Rolled-up CI checks on a PR's head commit. */
export type BranchPrChecks = "pending" | "passing" | "failing"

const FAILED_CONCLUSIONS = new Set([
  "failure",
  "timed_out",
  "cancelled",
  "action_required",
  "startup_failure",
])

/** Roll a head commit's check runs up into one state: any failure wins, then
 *  any run still going. Undefined when the commit has no checks. */
export function summarizeCheckRuns(
  runs: Array<{ status: string; conclusion: string | null }>
): BranchPrChecks | undefined {
  if (runs.length === 0) return undefined
  if (runs.some((r) => r.conclusion && FAILED_CONCLUSIONS.has(r.conclusion)))
    return "failing"
  if (runs.some((r) => r.status !== "completed")) return "pending"
  return "passing"
}
