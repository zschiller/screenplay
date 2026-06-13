export type HomeScope = {
  /** Whether the content grid scopes its contents to a folder (PRD #475). */
  folderView: boolean
  /** The folder being viewed (`null` = the "All files" root). */
  currentFolderId: string | null
}

/**
 * The home content grid scopes itself from the URL, not from page props. The
 * rooms/folders store is lifted into the persistent home shell (#510), so the
 * active route — not a per-page prop threaded through a thin page — tells the
 * one store whether it's showing the flat Recents list, the All files root, or
 * a single folder.
 *
 * - `/` (Recents): the flat, cross-folder recency list — no folder scoping.
 * - `/files`: the folder-tree root ("All files"), `currentFolderId` null.
 * - `/files/<id>`: a single folder, scoped to that id.
 * - anything else (e.g. `/settings`): no folder scoping.
 *
 * `folderId` comes straight from `useParams`, so it can be a string, an array
 * (catch-all routes), or undefined; only a plain string under the files tree
 * scopes the grid.
 */
export function deriveHomeScope(
  pathname: string,
  folderId: string | string[] | undefined
): HomeScope {
  const folderView = pathname === "/files" || pathname.startsWith("/files/")
  const currentFolderId =
    folderView && typeof folderId === "string" ? folderId : null
  return { folderView, currentFolderId }
}
