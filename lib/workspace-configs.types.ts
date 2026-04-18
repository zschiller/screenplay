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
  createdAt: number
  updatedAt: number
}
