"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { listBranchPullRequest, type BranchPrInfo } from "@/lib/github-actions"

const POLL_INTERVAL = 60_000

/**
 * Poll open/merged PR status for agent branches.
 * Returns a map of agentId -> BranchPrInfo.
 */
export function useBranchPrs(
  agents: Array<{ id: string; branch: string; repoId: string }>,
  repos: Array<{ id: string; repoOwner: string; repoName: string; defaultBranch: string }>,
): Map<string, BranchPrInfo> {
  const [prMap, setPrMap] = useState<Map<string, BranchPrInfo>>(new Map())
  const agentsRef = useRef(agents)
  const reposRef = useRef(repos)
  agentsRef.current = agents
  reposRef.current = repos

  const fetchAll = useCallback(async () => {
    const currentAgents = agentsRef.current
    const currentRepos = reposRef.current
    const repoMap = new Map(currentRepos.map((w) => [w.id, w]))

    const candidates = currentAgents.filter((a) => a.branch)
    if (candidates.length === 0) {
      setPrMap(new Map())
      return
    }

    const entries = await Promise.all(
      candidates.map(async (agent) => {
        const ws = repoMap.get(agent.repoId)
        if (!ws || agent.branch === ws.defaultBranch) return null
        const pr = await listBranchPullRequest(ws.repoOwner, ws.repoName, agent.branch)
        if (!pr) return null
        return [agent.id, pr] as const
      }),
    )
    const next = new Map<string, BranchPrInfo>()
    for (const entry of entries) {
      if (entry) next.set(entry[0], entry[1])
    }
    setPrMap(next)
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetchAll])

  return prMap
}
