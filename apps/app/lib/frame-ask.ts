import { sortForSidebar } from "@/lib/sidebar-order"
import type { BranchData, RepoData } from "@/lib/types"

/**
 * The Repo a new Workspace starts in: the one used last (the newest
 * Workspace's), else the first in sidebar order. The New Workspace dialog
 * preselects it, and the frame ask card's New chat creates in it.
 */
export function defaultNewWorkspaceRepoId(
  repos: RepoData[],
  branches: BranchData[]
): string | null {
  const sorted = sortForSidebar(repos, (a, b) =>
    a.repoFullName.localeCompare(b.repoFullName)
  )
  const repoIds = new Set(sorted.map((r) => r.id))
  let newest: BranchData | undefined
  for (const b of branches) {
    if (!repoIds.has(b.repoId)) continue
    if (!newest || b.createdAt > newest.createdAt) newest = b
  }
  return newest?.repoId ?? sorted[0]?.id ?? null
}

/**
 * The prompt a drawn frame's ask card sends: what was typed, then the frame's
 * size as the viewport, so a phone-sized box gets a mobile take.
 */
export function withViewport(
  prompt: string,
  size: { width: number; height: number }
): string {
  const viewport = `For a ${Math.round(size.width)} × ${Math.round(size.height)} viewport.`
  const text = prompt.trim()
  return text ? `${text}\n\n${viewport}` : viewport
}
