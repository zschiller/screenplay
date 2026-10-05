import type { BranchPrInfo, BranchPrState } from "@/lib/github-actions"
import type { BranchData, PastPr } from "@/lib/types"

/**
 * A Branch's PR history (#1701). A Branch keeps one ref and ships PRs one
 * after another from it: the **current PR** sits in today's `pr*` fields
 * (what the chat header shows) and the ones before it in `pastPrs`. When a
 * new PR opens, the current one moves into the list. The chat menu's Pull
 * requests group reads both through {@link branchPrList}.
 *
 * Pure, so `pr-history.test.ts` asserts the doc writes with no GitHub and no
 * Y.Doc; the poll (`listBranchPrs`) and the optimistic write on create
 * (`useBranchPrs`) both go through {@link prCacheUpdate}.
 */

/** The cached PR fields {@link prCacheUpdate} reads and writes. */
export type BranchPrCache = Pick<
  BranchData,
  "prNumber" | "prUrl" | "prTitle" | "prState" | "prBlocked" | "pastPrs"
>

/** A PR as the GitHub lookup returns it, with its title when known. */
export type FetchedPr = BranchPrInfo

/** How many past PRs a Branch keeps. Plenty for one chat's lifetime. */
const MAX_PAST_PRS = 50

function samePast(a: PastPr, b: PastPr): boolean {
  return (
    a.number === b.number &&
    a.url === b.url &&
    a.title === b.title &&
    a.state === b.state
  )
}

function toPast(pr: FetchedPr): PastPr {
  return {
    number: pr.number,
    url: pr.url,
    ...(pr.title ? { title: pr.title } : {}),
    state: pr.state,
  }
}

/** Past PRs with `fresh` folded in: known ones updated (a title GitHub
 *  didn't send is kept), unknown ones ignored. */
function refreshPast(
  past: readonly PastPr[],
  fresh: readonly FetchedPr[]
): PastPr[] {
  const byNumber = new Map(fresh.map((p) => [p.number, p]))
  return past.map((p) => {
    const f = byNumber.get(p.number)
    if (!f) return p
    return { ...p, url: f.url, state: f.state, title: f.title ?? p.title }
  })
}

/**
 * The doc write that records `pr` as the Branch's current PR, or null when
 * the cache already says so.
 *
 * - A newer PR than the cached one becomes current, and the cached one moves
 *   to the front of `pastPrs` with its last known state.
 * - An older one never replaces the current PR: GitHub's pulls list lags a
 *   beat behind a PR just opened, so a poll can still see the one before.
 *   It only refreshes that PR in `pastPrs`.
 * - `earlier` (the Branch's other PRs, as GitHub lists them) refreshes the
 *   state and title of the past PRs it names.
 */
export function prCacheUpdate(
  cur: BranchPrCache,
  pr: FetchedPr,
  earlier: readonly FetchedPr[] = []
): Partial<BranchData> | null {
  const past = cur.pastPrs ?? []
  const curNumber = cur.prNumber
  const older = typeof curNumber === "number" && pr.number < curNumber
  let nextPast = refreshPast(past, older ? [pr, ...earlier] : earlier)
  const patch: Partial<BranchData> = {}

  if (!older) {
    if (
      typeof curNumber === "number" &&
      curNumber !== pr.number &&
      cur.prUrl &&
      cur.prState
    ) {
      const moved = toPast({
        number: curNumber,
        url: cur.prUrl,
        title: cur.prTitle,
        state: cur.prState,
      })
      // GitHub may already know how the old one ended.
      const [fresh] = refreshPast([moved], earlier)
      nextPast = [
        fresh!,
        ...nextPast.filter((p) => p.number !== curNumber),
      ].slice(0, MAX_PAST_PRS)
    }
    const title =
      pr.title ?? (curNumber === pr.number ? cur.prTitle : undefined)
    if (
      cur.prNumber !== pr.number ||
      cur.prUrl !== pr.url ||
      cur.prState !== pr.state ||
      cur.prBlocked !== pr.blocked ||
      cur.prTitle !== title
    ) {
      patch.prNumber = pr.number
      patch.prUrl = pr.url
      patch.prState = pr.state
      patch.prBlocked = pr.blocked
      patch.prTitle = title
    }
  }

  if (
    nextPast.length !== past.length ||
    nextPast.some((p, i) => !samePast(p, past[i]!))
  ) {
    patch.pastPrs = nextPast
  }
  return Object.keys(patch).length > 0 ? patch : null
}

/** One row of the chat menu's Pull requests group. */
export interface PrListItem {
  number: number
  url: string
  title?: string
  state: BranchPrState
}

/**
 * Every PR the Branch opened, newest first: the current one, then the past
 * ones. `newer` is a PR the poll hasn't cached yet (a chat's fresh
 * `create_pr` result, through Create PR Readiness); it leads when it's newer
 * than the cached current PR.
 */
export function branchPrList(
  branch: BranchPrCache,
  newer?: { number: number; url: string; state: BranchPrState } | null
): PrListItem[] {
  const items: PrListItem[] = []
  const seen = new Set<number>()
  const add = (item: PrListItem) => {
    if (seen.has(item.number)) return
    seen.add(item.number)
    items.push(item)
  }
  if (
    newer &&
    (branch.prNumber === undefined || newer.number > branch.prNumber)
  )
    add({ number: newer.number, url: newer.url, state: newer.state })
  if (typeof branch.prNumber === "number" && branch.prUrl && branch.prState) {
    add({
      number: branch.prNumber,
      url: branch.prUrl,
      title: branch.prTitle,
      state: branch.prState,
    })
  }
  for (const p of branch.pastPrs ?? []) add(p)
  return items.sort((a, b) => b.number - a.number)
}
