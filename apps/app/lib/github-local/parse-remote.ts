/**
 * Parse a GitHub repo identity out of a clone URL / remote. Pure and
 * isomorphic — the add-by-URL field uses it client-side for instant feedback,
 * and the local-folder inspector uses it server-side on the clone's `origin`.
 *
 * Returns `null` for anything that isn't recognizably a GitHub repo (other
 * hosts, bare paths). A null identity is not an error: such a Repo still works
 * through the no-auth floor — clone/fetch/push ride host git auth — it just
 * gets no GitHub-API features (repo metadata, Branch-via-API, PRs).
 */
export interface GitHubRepoIdentity {
  owner: string
  name: string
}

const GITHUB_REMOTE_PATTERNS = [
  // https://github.com/owner/name(.git), with optional user@ and trailing /
  /^https?:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  // git@github.com:owner/name(.git)  (scp-like syntax)
  /^(?:[^@]+)@github\.com:([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
  // ssh://git@github.com/owner/name(.git)
  /^ssh:\/\/(?:[^@/]+@)?github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i,
]

export function parseGitHubRemote(remote: string): GitHubRepoIdentity | null {
  const trimmed = remote.trim()
  for (const pattern of GITHUB_REMOTE_PATTERNS) {
    const match = trimmed.match(pattern)
    if (match) return { owner: match[1], name: match[2] }
  }
  return null
}
