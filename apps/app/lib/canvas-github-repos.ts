import type { GitHubRepoRef } from "@/lib/github-issues"
import type { RoomCollections } from "@/lib/yjs/schema"

/**
 * Which GitHub repository an agent's GitHub tool or a merge card means: one
 * of the canvas's repositories, never any other. The agent's GitHub tools and
 * the merge card's actions both pick through here, so neither reaches past
 * the canvas.
 */
export type CanvasRepo = GitHubRepoRef & { id: string }

/** The canvas's repositories that live on GitHub. */
export function canvasGitHubRepos(c: RoomCollections): CanvasRepo[] {
  return c.repos
    .toArray()
    .filter((r) => r.repoOwner && r.repoName)
    .map((r) => ({ id: r.id, owner: r.repoOwner, name: r.repoName }))
}

/**
 * `owner/name` among `repos`, any case; with none named, the chat's own
 * repository or the canvas's only one. An error reads as a reply to the agent.
 */
export function pickCanvasRepo(
  repos: CanvasRepo[],
  named: string | undefined,
  ownRepoId?: string
): { repo: CanvasRepo } | { error: string } {
  const names = repos.map((r) => `${r.owner}/${r.name}`).join(", ")
  const none = "This canvas has no GitHub repositories."
  if (named) {
    const want = named.trim().toLowerCase()
    const repo = repos.find(
      (r) => `${r.owner}/${r.name}`.toLowerCase() === want
    )
    if (repo) return { repo }
    return {
      error: repos.length
        ? `${named} isn’t one of this canvas’s repositories: ${names}.`
        : none,
    }
  }
  const repo =
    repos.find((r) => r.id === ownRepoId) ??
    (repos.length === 1 ? repos[0] : undefined)
  if (repo) return { repo }
  return {
    error: repos.length
      ? `Name the repository: this canvas has ${names}.`
      : none,
  }
}
