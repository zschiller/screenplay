"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { compareBranch } from "@/lib/github-actions"

export type DiffStats = { additions: number; deletions: number }

const POLL_INTERVAL = 30_000

/**
 * Poll diff stats for agents via the GitHub compare API.
 * Returns a map of agentId -> { additions, deletions }.
 */
export function useDiffStats(
  agents: Array<{ id: string; branch: string; status: string; workspaceId: string }>,
  workspaces: Array<{ id: string; repoOwner: string; repoName: string; defaultBranch: string }>,
): Map<string, DiffStats> {
  const [statsMap, setStatsMap] = useState<Map<string, DiffStats>>(new Map())
  const agentsRef = useRef(agents)
  const workspacesRef = useRef(workspaces)
  agentsRef.current = agents
  workspacesRef.current = workspaces

  const fetchAll = useCallback(async () => {
    const currentAgents = agentsRef.current
    const currentWorkspaces = workspacesRef.current
    const workspaceMap = new Map(currentWorkspaces.map((w) => [w.id, w]))

    const running = currentAgents.filter((a) => a.status === "running" && a.branch)
    if (running.length === 0) {
      setStatsMap(new Map())
      return
    }

    const entries = await Promise.all(
      running.map(async (agent) => {
        const ws = workspaceMap.get(agent.workspaceId)
        if (!ws || agent.branch === ws.defaultBranch) return null
        const stats = await compareBranch(ws.repoOwner, ws.repoName, ws.defaultBranch, agent.branch)
        if (!stats) return null
        return [agent.id, stats] as const
      }),
    )
    const next = new Map<string, DiffStats>()
    for (const entry of entries) {
      if (entry) next.set(entry[0], entry[1])
    }
    setStatsMap(next)
  }, [])

  useEffect(() => {
    fetchAll()
    const id = setInterval(fetchAll, POLL_INTERVAL)
    return () => clearInterval(id)
  }, [fetchAll])

  return statsMap
}
