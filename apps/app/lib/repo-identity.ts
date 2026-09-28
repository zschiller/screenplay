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

/** The slice of a Repo that names it in the UI. */
export interface RepoNaming extends GitHubIdentity {
  name?: string
  repoFullName: string
  localPath?: string
}

/**
 * A Repo's short name (#880): its label (the preset name it was added with, or
 * one typed in its settings) when set, else the repository's own name. A
 * remote-less folder has no repository name, so it falls back to the folder's.
 */
export function repoShortName(repo: RepoNaming): string {
  return (
    repo.name?.trim() ||
    repo.repoName ||
    repo.localPath?.split(/[\\/]/).filter(Boolean).pop() ||
    repo.repoFullName
  )
}

/**
 * Where a Repo comes from, for the line under its short name: the folder on
 * this computer it was added from, else its `owner/name` on GitHub.
 */
export function repoSource(repo: RepoNaming): string {
  return repo.localPath || repo.repoFullName
}
