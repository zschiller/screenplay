"use client"

import { useCallback, useEffect, useMemo, useRef } from "react"
import { listBranchPrs, type BranchPrInfo } from "@/lib/github-actions"
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
 * The poll is one {@link listBranchPrs} server action for the whole Room: PR
 * Watch (`lib/pr-watch`) looks up every Branch's PR server-side, writes the
 * results back into the doc and adds PR events to the Workspace Chats. The doc
 * is the source of truth. The server tick runs the same look with the canvas
 * closed.
 */
export function useBranchPrs(
  agents: Array<{
    id: string
    ref: string
    repoId: string
    prNumber?: number
    prUrl?: string
    prState?: BranchPrInfo["state"]
    prBlocked?: BranchPrInfo["blocked"]
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
        m.set(a.id, {
          number: a.prNumber,
          url: a.prUrl,
          state: a.prState,
          blocked: a.prBlocked,
        })
      }
    }
    return m
  }, [agents])

  const refresh = useCallback(async () => {
    const repoMap = new Map(reposRef.current.map((w) => [w.id, w]))
    // Skip the round-trip when no Branch can have a PR of its own.
    const anyCandidate = agentsRef.current.some((a) => {
      const repo = repoMap.get(a.repoId)
      return !!a.ref && !!repo && a.ref !== repo.defaultBranch
    })
    if (!anyCandidate) return
    await listBranchPrs(roomId)
  }, [roomId])

  const setBranchPr = useCallback(
    (branchId: string, pr: BranchPrInfo) => {
      collections.branches.update(branchId, {
        prNumber: pr.number,
        prUrl: pr.url,
        prState: pr.state,
        prBlocked: pr.blocked,
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
