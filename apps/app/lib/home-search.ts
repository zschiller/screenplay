import { sortRooms, type SortKey, type SortOrder } from "@/lib/room-sort"
import { sortFolders, type FolderNode } from "@/lib/folder-tree"

// Pure, React-free helpers for the home search and ownership filter (#807).
// Search always spans the whole library, whichever folder is on screen: the
// point is finding a Canvas without knowing where it was filed, so each result
// carries its location.

/** Which Canvases the ownership filter keeps. */
export type OwnerFilter = "all" | "mine" | "shared"

type SearchableRoom = {
  id: string
  name: string
  isOwner: boolean
  createdAt: number
  lastConnectionAt: number | null
}

type SearchableFolder = FolderNode & { id: string }

/**
 * Whether `name` matches `query`: every whitespace-separated term must appear
 * somewhere in the name, ignoring case and accents, so "check mob" finds
 * "Mobile checkout". An empty query matches everything.
 */
export function matchesQuery(name: string, query: string): boolean {
  const haystack = fold(name)
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((term) => haystack.includes(term))
}

function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
}

/** Whether a query or a filter is narrowing the list, which swaps the folder
 * view for library-wide results. */
export function isSearching(query: string, owner: OwnerFilter): boolean {
  return query.trim() !== "" || owner !== "all"
}

/**
 * The Canvases and Folders matching `query` and `owner` across every folder,
 * each group ordered by the active sort. Folders are always the user's own, so
 * they drop out under "Shared with me", and they only match a typed query (a
 * bare ownership filter lists Canvases).
 */
export function searchLibrary<
  R extends SearchableRoom,
  F extends SearchableFolder,
>({
  rooms,
  folders,
  query,
  owner,
  sort,
  order,
}: {
  rooms: readonly R[]
  folders: readonly F[]
  query: string
  owner: OwnerFilter
  sort: SortKey
  order: SortOrder
}): { rooms: R[]; folders: F[] } {
  const keepRoom = (room: R) =>
    (owner === "all" || (owner === "mine" ? room.isOwner : !room.isOwner)) &&
    matchesQuery(room.name, query)
  const keepFolder = (folder: F) =>
    owner !== "shared" &&
    query.trim() !== "" &&
    matchesQuery(folder.name, query)
  return {
    rooms: sortRooms(rooms.filter(keepRoom), sort, order),
    folders: sortFolders(folders.filter(keepFolder), sort, order),
  }
}
