import { sortRooms, type SortKey, type SortOrder } from "@/lib/room-sort"

// Pure, React-free, DB-free helpers for the Folder tree (PRD #475). This slice
// only needs to partition a flat folder list by parent and order each level by
// the active sort key; deeper concerns (ancestor chains for the breadcrumb, the
// move cycle-guard) land in later slices.

export type FolderNode = {
  name: string
  parentFolderId: string | null
  createdAt: number
  updatedAt: number
}

/**
 * Order folders by the active sort key, reusing the Room sort's exact semantics
 * (`lib/room-sort`) so folders and the files below them read consistently. A
 * Folder has no separate "last opened" instant, so its `updatedAt` stands in for
 * the Room's last-edited time under the "Last edited" key.
 */
export function sortFolders<T extends FolderNode>(
  folders: readonly T[],
  sort: SortKey,
  order: SortOrder = "desc"
): T[] {
  const ranked = sortRooms(
    folders.map((folder) => ({
      folder,
      name: folder.name,
      createdAt: folder.createdAt,
      lastConnectionAt: folder.updatedAt,
    })),
    sort,
    order
  )
  return ranked.map((r) => r.folder)
}

/**
 * The folders directly under `parentFolderId` (null = the "All files" root),
 * ordered by the active sort key. The home list renders this above the files.
 */
export function foldersInParent<T extends FolderNode>(
  folders: readonly T[],
  parentFolderId: string | null,
  sort: SortKey,
  order: SortOrder = "desc"
): T[] {
  const children = folders.filter(
    (folder) => folder.parentFolderId === parentFolderId
  )
  return sortFolders(children, sort, order)
}
