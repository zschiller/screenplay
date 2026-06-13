import {
  sortRooms,
  type RoomSortable,
  type SortKey,
  type SortOrder,
} from "@/lib/room-sort"

// Pure, React-free, DB-free helpers for the Folder tree (PRD #475). They
// partition a flat folder list by parent, resolve a folder's ancestor chain for
// the breadcrumb, and split a folder's contents into sub-folders vs the Rooms
// filed into it — each group ordered by the active sort key via `room-sort`.

export type FolderNode = {
  name: string
  parentFolderId: string | null
  createdAt: number
  updatedAt: number
}

// A Room annotated with the folder it is filed under for the active user
// (`null` = the user's root). Extends the Room sort shape so a folder's Rooms
// order by the same key as everything else.
export type PlacedRoom = RoomSortable & {
  folderId: string | null
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

/**
 * The folders from the outermost ancestor down to and including `folderId`, in
 * root→current order — the trail the breadcrumb renders. Returns `[]` for the
 * root view (`folderId` null) or an id that isn't in `folders`. Walks
 * `parentFolderId` and stops if it ever revisits a folder, so a corrupt parent
 * cycle yields a finite chain instead of looping forever.
 */
export function ancestorChain<T extends FolderNode & { id: string }>(
  folders: readonly T[],
  folderId: string | null
): T[] {
  if (folderId === null) return []
  const byId = new Map(folders.map((folder) => [folder.id, folder]))
  const chain: T[] = []
  const seen = new Set<string>()
  let current: string | null = folderId
  while (current !== null && !seen.has(current)) {
    seen.add(current)
    const node = byId.get(current)
    if (!node) break
    chain.push(node)
    current = node.parentFolderId
  }
  return chain.reverse()
}

/**
 * The Rooms filed directly into `folderId` (null = the user's root), ordered by
 * the active sort key. Pairs with {@link foldersInParent}: a folder's view is
 * its sub-folders above the Rooms this returns, each group sorted the same way.
 */
export function roomsInFolder<T extends PlacedRoom>(
  rooms: readonly T[],
  folderId: string | null,
  sort: SortKey,
  order: SortOrder = "desc"
): T[] {
  const inFolder = rooms.filter((room) => room.folderId === folderId)
  return sortRooms(inFolder, sort, order)
}
