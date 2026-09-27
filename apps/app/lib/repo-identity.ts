/**
 * Repo identity predicates — what a {@link RepoData}'s GitHub identity does and
 * does not license a caller to do.
 *
 * A Repo resolves to a local `.git` two ways (CONTEXT.md, ADR 0013): a GitHub /
 * URL pick, or a folder already on disk. The remote *names* the Repo when the
 * folder has one, so `repoOwner` / `repoName` are the detected remote's — and
 * are empty strings for the remote-less tail: a folder with no `origin`, or one
 * whose `origin` is not GitHub (`inspectLocalRepoPath` only fills them from a
 * `parseGitHubRemote` hit). Anything that reaches the GitHub *API* for this Repo
 * has to ask before it calls, because the no-auth floor (ADR 0008) makes a
 * GitHub-less Repo an ordinary state, not an error.
 */

/** The slice of a Repo (or a Repo Config preset) that carries GitHub identity. */
export interface GitHubIdentity {
  repoOwner: string
  repoName: string
}

/**
 * Whether this Repo has a GitHub remote the GitHub API can act on. False for a
 * local-folder Repo with a non-GitHub `origin` or no `origin` at all — for those
 * the API can never name the repository, whatever token the caller holds.
 */
export function hasGitHubRemote(
  repo: Partial<GitHubIdentity> | null | undefined
): boolean {
  return Boolean(repo?.repoOwner && repo?.repoName)
}
