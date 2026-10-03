"use client"

import { useGitHubTokenAvailable } from "@/hooks/use-github-token"
import { hasGitHubRemote } from "@/lib/repo-identity"
import { useRepos } from "@/lib/yjs/react"

/**
 * Whether a Repository's Workspaces can open a pull request: it has a GitHub
 * remote and the GitHub API is reachable. False for a local-only repo and on
 * the desktop app with no GitHub connection, where Create pull request is
 * hidden rather than offered to fail. False until the token probe resolves.
 */
export function useCanCreatePr(repoId: string | undefined): boolean {
  const githubTokenAvailable = useGitHubTokenAvailable()
  const repo = useRepos().find((r) => r.id === repoId)
  return githubTokenAvailable && hasGitHubRemote(repo)
}
