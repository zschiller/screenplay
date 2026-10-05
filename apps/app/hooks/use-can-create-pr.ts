"use client"

import { useGitHubTokenProbe } from "@/hooks/use-github-token"
import { hasGitHubRemote } from "@/lib/repo-identity"
import type { RepoData } from "@/lib/types"
import { useRepos } from "@/lib/yjs/react"

/** Create pull request's tooltip when the repo is on GitHub but this person
 *  hasn't connected it (H3). */
export const CONNECT_GITHUB_FOR_PR_HINT =
  "Connect GitHub in Settings to open pull requests."

/**
 * Whether a Repository's Workspaces can open a pull request:
 *  - `ready`: it has a GitHub remote and the GitHub API is reachable.
 *  - `connect`: it has a GitHub remote but there's no GitHub connection (the
 *    desktop app before `gh auth login`). Create pull request shows disabled
 *    with {@link CONNECT_GITHUB_FOR_PR_HINT}, so people learn where to fix it.
 *  - `none`: no GitHub remote (a local-only repo), or the token probe hasn't
 *    resolved yet. Create pull request is hidden.
 */
export type PrAvailability = "ready" | "connect" | "none"

export function prAvailability(
  repo: RepoData | undefined,
  githubToken: boolean | undefined
): PrAvailability {
  if (!hasGitHubRemote(repo) || githubToken === undefined) return "none"
  return githubToken ? "ready" : "connect"
}

export function usePrAvailability(repoId: string | undefined): PrAvailability {
  const githubToken = useGitHubTokenProbe()
  const repo = useRepos().find((r) => r.id === repoId)
  return prAvailability(repo, githubToken)
}
