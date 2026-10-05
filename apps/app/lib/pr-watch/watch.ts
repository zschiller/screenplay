import type { PrEventKind, PrEventMark } from "@/lib/agent/message-markers"
import type { BranchPrChecks } from "@/lib/pr-checks"
import type { RoomDoc } from "@/lib/room-access"
import type { BranchData, PastPr, RepoData } from "@/lib/types"
import { prCacheUpdate } from "@/lib/branch/pr-history"

/**
 * **PR Watch** (#1702): the one module that owns “what changed on a Room's
 * PRs”. Given the Room and a GitHub reader, it looks up each Branch's current
 * PR, compares it with the PR cached on the Branch, writes the new state into
 * the doc, and returns the **PR events** the change amounts to. The browser's
 * poll and the server tick both run it (`run.ts`), so a PR is watched the same
 * way whether or not anyone has the canvas open.
 *
 * Free of the live database, GitHub and the broadcast, so the tests drive it
 * with a fake reader and a seeded doc.
 */

export type { PrEventKind }

/** One Branch PR Watch looks up: its repository and ref, and who owns it. */
export interface PrTarget {
  branchId: string
  owner: string
  repo: string
  branch: string
  /** The member who created the Branch (`BranchData.createdBy`), when known.
   *  The server tick reads GitHub with their account. */
  ownerId?: string
}

/** A PR as GitHub reports it now. */
export interface PrLookup {
  number: number
  url: string
  state: "open" | "closed" | "merged"
  /** Its title, when GitHub sent one. */
  title?: string
  /** The Branch's other PRs, newest first (#1701): they refresh the past PRs'
   *  states and titles. */
  earlier?: PastPr[]
  /** An open PR that can't merge: failing checks, a conflict, or a missing
   *  required review or check. */
  blocked?: boolean
  /** The open PR's rolled-up checks; absent when it has none. */
  checks?: BranchPrChecks
  /** The failed checks' names, when `checks` is failing. */
  failingChecks?: string[]
  /** Whether the open PR conflicts with its base. */
  conflict?: boolean
}

/** Looks up a Branch's newest PR; `null` when there is none or the lookup
 *  failed. */
export type GitHubPrReader = (target: PrTarget) => Promise<PrLookup | null>

/** A change on a Branch's PR that its Workspace Chat hears about. */
export interface PrEvent extends PrEventMark {
  branchId: string
  url: string
}

/** The Branch's cached PR, as the doc holds it. */
type CachedPr = Pick<
  BranchData,
  | "prNumber"
  | "prUrl"
  | "prState"
  | "prBlocked"
  | "prChecks"
  | "prChecksFailed"
  | "prConflict"
>

/**
 * The Branches PR Watch looks at: every Branch on its own ref of a GitHub
 * repository (not the default branch, which has no PR of its own). With
 * `openOnly`, only Branches whose cached PR is open: the server tick's set.
 */
export function prTargets(
  repos: readonly RepoData[],
  branches: readonly BranchData[],
  { openOnly = false }: { openOnly?: boolean } = {}
): PrTarget[] {
  const repoById = new Map(repos.map((r) => [r.id, r]))
  const targets: PrTarget[] = []
  for (const b of branches) {
    if (!b.ref) continue
    const repo = repoById.get(b.repoId)
    if (!repo || !repo.repoOwner || !repo.repoName) continue
    if (b.ref === repo.defaultBranch) continue
    if (openOnly && b.prState !== "open") continue
    targets.push({
      branchId: b.id,
      owner: repo.repoOwner,
      repo: repo.repoName,
      branch: b.ref,
      ...(b.createdBy ? { ownerId: b.createdBy } : {}),
    })
  }
  return targets
}

/**
 * The events between the cached PR and the one GitHub reports now. Only a PR
 * already cached under the same number has a before to compare with: a PR seen
 * for the first time is the new baseline and says nothing.
 */
export function prEvents(
  cached: CachedPr,
  next: PrLookup
): Array<Omit<PrEventMark, "number">> {
  if (cached.prNumber !== next.number || !cached.prState) return []
  const events: Array<Omit<PrEventMark, "number">> = []
  if (cached.prState === "open" && next.state === "merged") {
    events.push({ kind: "merged" })
  } else if (cached.prState === "open" && next.state === "closed") {
    events.push({ kind: "closed" })
  }
  if (next.state !== "open") return events

  if (next.checks === "failing" && cached.prChecks !== "failing") {
    const detail = next.failingChecks?.join(", ")
    events.push({ kind: "checks_failed", ...(detail ? { detail } : {}) })
  } else if (
    next.checks === "passing" &&
    (cached.prChecks === "failing" || cached.prChecksFailed)
  ) {
    events.push({ kind: "checks_passed" })
  }
  if (next.conflict && !cached.prConflict) events.push({ kind: "conflict" })
  return events
}

/** The cached fields a lookup writes. Checks and conflict only mean anything
 *  on an open PR, so a closed or merged one clears them. */
function cachedFields(cached: CachedPr, pr: PrLookup): CachedPr {
  const open = pr.state === "open"
  // Pending checks keep what the last finished run said.
  const failed =
    pr.checks === "failing" ||
    (pr.checks === "pending" &&
      cached.prNumber === pr.number &&
      (cached.prChecks === "failing" || !!cached.prChecksFailed))
  return {
    prNumber: pr.number,
    prUrl: pr.url,
    prState: pr.state,
    prBlocked: open ? pr.blocked || undefined : undefined,
    prChecks: open ? pr.checks : undefined,
    prChecksFailed: open && failed ? true : undefined,
    prConflict: open ? pr.conflict || undefined : undefined,
  }
}

function sameCache(a: CachedPr, b: CachedPr): boolean {
  return (
    a.prNumber === b.prNumber &&
    a.prUrl === b.prUrl &&
    a.prState === b.prState &&
    a.prBlocked === b.prBlocked &&
    a.prChecks === b.prChecks &&
    a.prChecksFailed === b.prChecksFailed &&
    a.prConflict === b.prConflict
  )
}

export interface PrWatchResult {
  /** Each looked-up Branch's PR, `null` when there was none or the lookup
   *  failed. */
  prs: Array<{ id: string; pr: PrLookup | null }>
  /** What changed, in Branch order. */
  events: PrEvent[]
  /** Whether any Branch in the Room has an open PR after this look, so the
   *  server tick knows to keep watching it. */
  hasOpenPr: boolean
}

/**
 * Look up the Room's PRs, write what changed into its doc and return the PR
 * events. A `null` lookup never clears a cached PR: GitHub's pulls list lags a
 * beat behind a freshly created PR, so a look already in flight when one is
 * opened can miss it, and clearing would flicker the badge back to “no PR”.
 *
 * Writes run server-side, so they reach clients as remote changes and never
 * land in anyone's undo history.
 */
export async function watchRoomPrs(
  room: RoomDoc,
  read: GitHubPrReader,
  { openOnly = false }: { openOnly?: boolean } = {}
): Promise<PrWatchResult> {
  const targets = await room.readDoc(({ repos, branches }) =>
    prTargets(repos.toArray(), branches.toArray(), { openOnly })
  )
  const prs = await Promise.all(
    targets.map(async (t) => ({
      id: t.branchId,
      pr: await read(t).catch(() => null),
    }))
  )
  return room.mutateDoc(({ branches }) => {
    const events: PrEvent[] = []
    for (const { id, pr } of prs) {
      if (!pr) continue
      const cur = branches.get(id)
      if (!cur) continue
      // The Branch's PR history (#1701): a newer PR moves the current one into
      // the past PRs; an older one (a lagging list) only refreshes them.
      const history = prCacheUpdate(cur, pr, pr.earlier ?? [])
      const historyPatch: Partial<BranchData> = {
        ...(history?.pastPrs ? { pastPrs: history.pastPrs } : {}),
        ...(history && "prTitle" in history
          ? { prTitle: history.prTitle }
          : {}),
      }
      if (typeof cur.prNumber === "number" && pr.number < cur.prNumber) {
        if (history?.pastPrs) branches.update(id, { pastPrs: history.pastPrs })
        continue
      }
      for (const e of prEvents(cur, pr)) {
        events.push({ ...e, branchId: id, number: pr.number, url: pr.url })
      }
      const next = cachedFields(cur, pr)
      const patch = {
        ...(sameCache(cur, next) ? {} : next),
        ...historyPatch,
      }
      if (Object.keys(patch).length > 0) branches.update(id, patch)
    }
    const hasOpenPr = branches.toArray().some((b) => {
      const latest = branches.get(b.id)
      return latest?.prState === "open"
    })
    return { prs, events, hasOpenPr }
  })
}
