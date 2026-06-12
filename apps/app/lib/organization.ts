export type Folder = {
  id: string
  name: string
  createdAt: number
}

export type OrganizationState = {
  /** Array order is the sidebar display order (drag-to-reorder). */
  folders: Folder[]
  fileFolder: Record<string, string>
  pinnedFiles: string[]
  pinnedFolders: string[]
  /**
   * Manual within-folder file order, folderId → ordered file ids. Files
   * filed in a folder but missing from its list (never dragged) sort after
   * the ordered ones, in their natural order.
   */
  fileOrder: Record<string, string[]>
  /**
   * Folders currently expanded in the sidebar. Server-side (not
   * localStorage) so the state survives origin changes — the desktop dev
   * server picks a new port (= new localStorage) on every restart.
   */
  openFolders: string[]
}

export const DRAFTS_FOLDER_ID = "drafts"
