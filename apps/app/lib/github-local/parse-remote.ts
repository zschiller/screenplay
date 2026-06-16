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

/**
 * Does this input look like a clone URL (any host), rather than a repo-name
 * search term? Pure and client-side: the unified add-repo picker calls it on
 * every keystroke to decide whether to surface the "Add <url>" row, so it stays
 * deliberately conservative — a bare `owner/repo` or a one-word search must not
 * read as a URL (acceptance: no false "Add URL" row). Resolution itself (and
 * any non-GitHub no-auth-floor handling) still happens in `resolveRepoFromUrl`.
 */
export function looksLikeCloneUrl(input: string): boolean {
  const s = input.trim()
  // URLs carry no whitespace; a multi-word search never resolves to one.
  if (!s || /\s/.test(s)) return false
  // scheme://…  — https, http, ssh, git, file
  if (/^(?:https?|ssh|git|file):\/\/.+/i.test(s)) return true
  // scp-like: user@host:path  (e.g. git@github.com:owner/repo.git)
  if (/^[^@\s]+@[^:\s]+:.+/.test(s)) return true
  // bare host/path that names a git repo explicitly
  if (/\.git$/i.test(s) && s.includes("/")) return true
  return false
}
