export type RepoConfig = {
  id: string
  name: string
  repoFullName: string
  repoOwner: string
  repoName: string
  defaultBranch: string
  cloneUrl: string
  private: boolean
  setupScript: string
  devScript: string
  devServerPort: number
  envVars: string
  /** Preset id from `lib/iframeLayer-sizes`. Falls back to the default preset when unset. */
  defaultIframeLayerSizeId?: string
  /** Extra workspace-specific instructions appended to the agent's system prompt. */
  systemPrompt?: string
  createdAt: number
  updatedAt: number
}
