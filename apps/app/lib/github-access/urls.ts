/**
 * Pure GitHub URL rules every {@link GitHubAccess} implementation shares. No
 * `server-only`: the parsing is isomorphic and the PR-link reader runs in the
 * browser.
 */

/**
 * github.com's REST and web bases, which every built-in uses. A fork on
 * GitHub Enterprise gives its own {@link GitHubAccess} other ones.
 */
export const GITHUB_DOT_COM_URLS = {
  apiUrl: "https://api.github.com",
  webUrl: "https://github.com",
} as const

/** A repo's identity on GitHub, as its remote names it. */
export interface GitHubRepoIdentity {
  owner: string
  name: string
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * Parse a repo identity out of a clone URL or remote on the GitHub at
 * `webUrl`. Returns `null` for anything else (other hosts, bare paths): such a
 * Repo still clones and pushes through host git, it just gets no GitHub API
 * features.
 */
export function parseGitHubRemote(
  remote: string,
  webUrl: string
): GitHubRepoIdentity | null {
  let host: string
  try {
    host = new URL(webUrl).host
  } catch {
    return null
  }
  const h = escapeRegExp(host)
  const patterns = [
    // https://host/owner/name(.git), with optional user@ and trailing /
    new RegExp(
      `^https?:\\/\\/(?:[^@/]+@)?${h}\\/([^/]+)\\/([^/]+?)(?:\\.git)?\\/?$`,
      "i"
    ),
    // git@host:owner/name(.git)  (scp-like syntax)
    new RegExp(`^(?:[^@]+)@${h}:([^/]+)\\/([^/]+?)(?:\\.git)?\\/?$`, "i"),
    // ssh://git@host/owner/name(.git)
    new RegExp(
      `^ssh:\\/\\/(?:[^@/]+@)?${h}\\/([^/]+)\\/([^/]+?)(?:\\.git)?\\/?$`,
      "i"
    ),
  ]
  const trimmed = remote.trim()
  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match) return { owner: match[1], name: match[2] }
  }
  return null
}

/**
 * The first pull request link in `text`, on any GitHub host. The link comes
 * from GitHub's own API response (`html_url`), so it already carries the
 * configured host; matching the `/pull/<n>` path keeps the browser free of
 * host config.
 */
export function findPullRequestUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s/]+\/[^\s]+?\/pull\/\d+/)?.[0] ?? null
}
