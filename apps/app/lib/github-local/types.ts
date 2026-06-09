/**
 * A Repo about to be added from one of the local build's no-auth entry points —
 * a pasted clone URL or a local folder (PRD #428). Shaped to slot straight into
 * `RepoData` in `handleCreateRepo`: the GitHub identity fields are best-effort
 * (parsed from the URL / the clone's `origin` remote) and empty when the source
 * isn't a GitHub repo, which simply leaves the GitHub-API features dark for it.
 *
 * Isomorphic on purpose: the repo picker (client) carries this from the
 * inspect/resolve server actions into the canvas's Repo-creation op.
 */
export type NewRepoSource = {
  /** Display name; defaults to the repo/folder name. */
  name: string
  /** `owner/name` when known, else a readable fallback (URL or folder path). */
  repoFullName: string
  /** Empty when the source has no GitHub identity. */
  repoOwner: string
  /** Empty when the source has no GitHub identity. */
  repoName: string
  defaultBranch: string
  /** Empty for a local folder with no usable remote. */
  cloneUrl: string
  /**
   * Absolute path of the user's existing clone. Set only for the local-folder
   * entry point — its presence is what routes acquisition down the
   * `local-path` arm of `RepoSource`.
   */
  localPath?: string
}
