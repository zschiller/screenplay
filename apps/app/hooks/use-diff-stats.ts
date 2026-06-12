"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { compareBranches, type DiffStatQuery } from "@/lib/github-actions"
import { useRoomId } from "@/lib/yjs/context"

export type DiffStats = { additions: number; deletions: number }

const POLL_INTERVAL = 30_000

/**
 * Diff stats per agent, read straight from the cached fields on each Branch in
 * the room's Y.Doc — so a cold load and every collaborator render the badge
 * instantly, with no client-side GitHub round-trip.
 *
 * The poll's only job is to keep that cache fresh: it batches all running
 * branches into a single {@link compareBranches} server action (one round-trip,
 * GitHub calls fanned out in parallel server-side) which writes the results
 * back into the doc. We don't hold the values in React state — the doc is the
 * source of truth and the parent re-renders with updated Branch props when it
 * changes.
 */
export function useDiffStats(
  agents: Array<{
    id: string
    ref: string
    status: string
    repoId: string
    diffAdditions?: number
    diffDeletions?: number
  }>,
  repos: Array<{
    id: string
    repoOwner: string
    repoName: string
    defaultBranch: string
  }>
): Map<string, DiffStats> {
  const roomId = useRoomId()
  const agentsRef = useRef(agents)
  const reposRef = useRef(repos)
  // Latest inputs kept in refs (updated after commit) so the polling loop
  // reads current values without restarting on every render.
  useEffect(() => {
    agentsRef.current = agents
    reposRef.current = repos
  })

  // Restricted to running agents so a stopped branch doesn't keep showing a
  // stale badge from its last cached value.
  const statsMap = useMemo(() => {
    const m = new Map<string, DiffStats>()
    for (const a of agents) {
      if (a.status !== "running") continue
      if (
        typeof a.diffAdditions === "number" &&
        typeof a.diffDeletions === "number"
      ) {
        m.set(a.id, { additions: a.diffAdditions, deletions: a.diffDeletions })
      }
    }
    return m
  }, [agents])

  const refresh = useCallback(async () => {
    const currentAgents = agentsRef.current
    const repoMap = new Map(reposRef.current.map((w) => [w.id, w]))
    const queries: DiffStatQuery[] = []
    for (const a of currentAgents) {
      if (a.status !== "running" || !a.ref) continue
      const ws = repoMap.get(a.repoId)
      if (!ws || a.ref === ws.defaultBranch) continue
      queries.push({
        id: a.id,
        owner: ws.repoOwner,
        repo: ws.repoName,
        base: ws.defaultBranch,
        head: a.ref,
      })
    }
    if (queries.length === 0) return
    await compareBranches(roomId, queries)
  }, [roomId])

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [refresh])

  return statsMap
}
