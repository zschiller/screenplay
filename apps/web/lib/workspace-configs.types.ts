export type WorkspaceConfig = {
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
  /** Preset id from `lib/artboard-sizes`. Falls back to the default preset when unset. */
  defaultArtboardSizeId?: string
  createdAt: number
  updatedAt: number
}
