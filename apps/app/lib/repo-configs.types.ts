export type RepoConfig = {
  id: string
  name: string
  repoFullName: string
  repoOwner: string
  repoName: string
  defaultBranch: string
  cloneUrl: string
  /**
   * Absolute path of an existing local checkout this preset was made from
   * (desktop-only; ADR 0013). The acquisition hint: adding the preset to a Room
   * points the Repo at *that* checkout rather than re-cloning. Identity still
   * prefers the detected git remote — a `localPath` may ride alongside a
   * remote-derived `repoFullName`/`cloneUrl`. Absent = a non-folder preset.
   */
  localPath?: string
  private: boolean
  setupScript: string
  devScript: string
  devServerPort: number
  envVars: string
  /**
   * Glob patterns (one per line, e.g. `.env*`) of files copied from the
   * original checkout into each workspace's worktree. Desktop-mode (local
   * build) replacement for hand-written `envVars`.
   */
  copyPatterns?: string
  /** Preset id from `lib/iframeLayer-sizes`. Falls back to the default preset when unset. */
  defaultIframeLayerSizeId?: string
  /** Extra workspace-specific instructions appended to the agent's system prompt. */
  systemPrompt?: string
  createdAt: number
  updatedAt: number
}
