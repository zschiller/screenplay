/** Rolled-up CI checks on a PR's head commit. */
export type BranchPrChecks = "pending" | "passing" | "failing"

/** GitHub `mergeable_state` values that mean the PR can't be merged as it
 *  stands: `dirty` is a merge conflict, `blocked` a failing required check or
 *  a missing required review. */
const BLOCKED_MERGEABLE_STATES = new Set(["blocked", "dirty"])

/** Whether an open PR's merge is blocked: its checks fail, or GitHub says it
 *  can't merge. An unknown (still computing) state doesn't block. */
export function isMergeBlocked(
  mergeableState: string | null | undefined,
  checks: BranchPrChecks | undefined
): boolean {
  return (
    checks === "failing" ||
    (!!mergeableState && BLOCKED_MERGEABLE_STATES.has(mergeableState))
  )
}

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

/** The names of a head commit's failed check runs, in GitHub's order and
 *  without repeats (a matrix job reports one run per leg under one name). */
export function failingCheckNames(
  runs: Array<{ name?: string; conclusion: string | null }>
): string[] {
  const names: string[] = []
  for (const run of runs) {
    if (!run.name || !run.conclusion) continue
    if (!FAILED_CONCLUSIONS.has(run.conclusion)) continue
    if (!names.includes(run.name)) names.push(run.name)
  }
  return names
}

/** Whether GitHub's `mergeable_state` says the PR conflicts with its base. */
export function isConflicted(mergeableState: string | null | undefined) {
  return mergeableState === "dirty"
}
