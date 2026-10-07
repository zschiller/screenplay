/**
 * Pure GitHub URL rules every {@link GitHubAccess} implementation shares. No
 * `server-only`: the parsing is isomorphic and the PR-link reader runs in the
 * browser.
 */

/** The public github.com host, the default for every built-in. */
export const GITHUB_DOT_COM = "github.com"

/**
 * The REST and web bases for a GitHub hostname:
 * - `github.com` → `https://api.github.com`, `https://github.com`
 * - GHE.com data residency (`<sub>.ghe.com`) → `https://api.<sub>.ghe.com`
 * - anything else is GitHub Enterprise Server → `https://<host>/api/v3`
 */
export function githubUrlsForHostname(hostname: string): {
  apiUrl: string
  webUrl: string
} {
  const host = hostname.trim().toLowerCase()
  if (host === GITHUB_DOT_COM) {
    return { apiUrl: "https://api.github.com", webUrl: "https://github.com" }
  }
  if (host.endsWith(".ghe.com")) {
    return { apiUrl: `https://api.${host}`, webUrl: `https://${host}` }
  }
  return { apiUrl: `https://${host}/api/v3`, webUrl: `https://${host}` }
}

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
