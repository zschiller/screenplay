export type Folder = {
  id: string
  name: string
  createdAt: number
}

export type OrganizationState = {
  folders: Folder[]
  fileFolder: Record<string, string>
  pinnedFiles: string[]
  pinnedFolders: string[]
}

export const DRAFTS_FOLDER_ID = "drafts"
