"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import {
  listBranchPrs,
  type BranchPrInfo,
  type BranchPrQuery,
} from "@/lib/github-actions"
import { useRoomId } from "@/lib/yjs/context"
import { useRoomCollections } from "@/lib/yjs/react"

const POLL_INTERVAL = 60_000

export interface BranchPrsHandle {
  /**
   * Latest known PR per branch id — the single source of truth the sidebar
   * icon, the branch overflow menu, and the chat-panel button all read from.
   * Derived from the cached PR fields on each Branch in the room's Y.Doc.
   */
  branchPrs: Map<string, BranchPrInfo>
  /**
   * Optimistically record a branch's PR without waiting for the next poll.
   * Called the instant a PR is created so the icon, menu, and button reflect
   * it immediately rather than up to {@link POLL_INTERVAL}ms later; the write
   * goes straight into the doc so collaborators see it too, and the poll
   * reconciles it to the authoritative state afterwards.
   */
  setBranchPr: (branchId: string, pr: BranchPrInfo) => void
}

/**
 * Open/merged PR status for agent branches, read straight from the cached
 * fields on each Branch in the room's Y.Doc — instant on a cold load and shared
 * across collaborators, no per-client GitHub round-trip on render.
 *
 * The poll batches every candidate branch into one {@link listBranchPrs} server
 * action (single round-trip, GitHub calls fanned out in parallel server-side)
 * which writes results back into the doc. The doc is the source of truth.
 */
export function useBranchPrs(
  agents: Array<{
    id: string
    ref: string
    repoId: string
    prNumber?: number
    prUrl?: string
    prState?: BranchPrInfo["state"]
  }>,
  repos: Array<{
    id: string
    repoOwner: string
    repoName: string
    defaultBranch: string
  }>
): BranchPrsHandle {
  const roomId = useRoomId()
  const collections = useRoomCollections()
  const agentsRef = useRef(agents)
  const reposRef = useRef(repos)
  // Latest inputs kept in refs (updated after commit) so the polling loop
  // reads current values without restarting on every render.
  useEffect(() => {
    agentsRef.current = agents
    reposRef.current = repos
  })

  const branchPrs = useMemo(() => {
    const m = new Map<string, BranchPrInfo>()
    for (const a of agents) {
      if (a.prState && typeof a.prNumber === "number" && a.prUrl) {
        m.set(a.id, { number: a.prNumber, url: a.prUrl, state: a.prState })
      }
    }
    return m
  }, [agents])

  const refresh = useCallback(async () => {
    const currentAgents = agentsRef.current
    const repoMap = new Map(reposRef.current.map((w) => [w.id, w]))
    const queries: BranchPrQuery[] = []
    for (const a of currentAgents) {
      if (!a.ref) continue
      const ws = repoMap.get(a.repoId)
      if (!ws || a.ref === ws.defaultBranch) continue
      queries.push({
        id: a.id,
        owner: ws.repoOwner,
        repo: ws.repoName,
        branch: a.ref,
      })
    }
    if (queries.length === 0) return
    await listBranchPrs(roomId, queries)
  }, [roomId])

  const setBranchPr = useCallback(
    (branchId: string, pr: BranchPrInfo) => {
      collections.branches.update(branchId, {
        prNumber: pr.number,
        prUrl: pr.url,
        prState: pr.state,
      })
    },
    [collections]
  )

  useEffect(() => {
    refresh()
    const id = setInterval(refresh, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [refresh])

  return { branchPrs, setBranchPr }
}
