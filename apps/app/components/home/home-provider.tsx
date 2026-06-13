"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react"
import {
  createRoom as createRoomAction,
  deleteRoom as deleteRoomAction,
  listRooms,
  renameRoom as renameRoomAction,
  type RoomSummary,
} from "@/lib/rooms-actions"
import {
  createFolder as createFolderAction,
  listRoomPlacements,
  placeRoom as placeRoomAction,
  renameFolder as renameFolderAction,
  type FolderSummary,
  type RoomPlacementSummary,
} from "@/lib/folders-actions"
import { sortRooms, type SortKey, type SortOrder } from "@/lib/room-sort"
import {
  ancestorChain,
  foldersInParent,
  roomsInFolder,
} from "@/lib/folder-tree"
import { useRoomThumbnailPoll } from "./use-room-thumbnail-poll"

export type View = "grid" | "table"
export type { SortKey, SortOrder }

/** A→Z reads as the natural default for names; everything else newest-first. */
export function defaultOrder(sort: SortKey): SortOrder {
  return sort === "name" ? "asc" : "desc"
}

type HomeContextValue = {
  /**
   * The Rooms on screen, ordered by the current sort. In a folder view this is
   * only the Rooms filed into the current folder; in the flat view (Recents)
   * it's every Room the user can see.
   */
  rooms: RoomSummary[]
  /**
   * The sub-folders of the current folder, ordered by the current sort. Empty
   * in the flat view (Recents shows no folders).
   */
  folders: FolderSummary[]
  /** Whether this provider scopes its contents to a folder (PRD #475). */
  folderView: boolean
  /** The folder being viewed (`null` = the "All files" root). */
  currentFolderId: string | null
  /**
   * The current folder's ancestor trail, root→current (including the current
   * folder), for the breadcrumb. Empty at the root.
   */
  ancestors: FolderSummary[]
  loading: boolean
  view: View
  setView: (v: View) => void
  sort: SortKey
  setSort: (s: SortKey) => void
  order: SortOrder
  setOrder: (o: SortOrder) => void

  createRoom: (name: string) => Promise<RoomSummary>
  renameRoom: (id: string, name: string) => Promise<void>
  removeRoom: (id: string) => Promise<void>
  createFolder: (name: string) => Promise<FolderSummary>
  renameFolder: (id: string, name: string) => Promise<void>
}

const HomeContext = createContext<HomeContextValue | null>(null)

export function useHome(): HomeContextValue {
  const ctx = useContext(HomeContext)
  if (!ctx) throw new Error("useHome must be used within HomeProvider")
  return ctx
}

export function HomeProvider({
  children,
  initialRooms,
  initialFolders,
  initialPlacements,
  // A folder-scoped view (All files / a folder) partitions its contents by the
  // current folder; the flat view (Recents) leaves this off and shows every
  // Room with no folders. `currentFolderId` only applies when `folderView` is
  // on (`null` = the root "All files").
  folderView = false,
  currentFolderId = null,
}: {
  children: React.ReactNode
  initialRooms?: RoomSummary[]
  initialFolders?: FolderSummary[]
  initialPlacements?: RoomPlacementSummary[]
  folderView?: boolean
  currentFolderId?: string | null
}) {
  const [rooms, setRooms] = useState<RoomSummary[]>(initialRooms ?? [])
  const [folders, setFolders] = useState<FolderSummary[]>(initialFolders ?? [])
  const [placements, setPlacements] = useState<RoomPlacementSummary[]>(
    initialPlacements ?? []
  )
  // With server-seeded rooms the grid is ready on first paint — no loading
  // state, which is what avoids the empty-grid flash on the desktop build.
  const [loading, setLoading] = useState(!initialRooms)
  const [view, setView] = useState<View>("grid")
  const [sort, setSortKey] = useState<SortKey>("updated")
  const [order, setOrder] = useState<SortOrder>(defaultOrder("updated"))

  // Switching the sort key resets direction to that key's natural default
  // (names A→Z, timestamps newest-first); the user can then flip it.
  const setSort = useCallback((next: SortKey) => {
    setSortKey(next)
    setOrder(defaultOrder(next))
  }, [])

  useEffect(() => {
    // Already seeded server-side; skip the client fetch (and its flash).
    if (initialRooms) return
    let cancelled = false
    listRooms()
      .then((roomList) => {
        if (!cancelled) setRooms(roomList)
      })
      .catch((err) => console.error("Failed to load rooms", err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [initialRooms])

  // The folder view needs each user's placements to know which Rooms belong to
  // the folder on screen. Seed them server-side like rooms; only fall back to a
  // client fetch when they weren't provided and we're actually scoping by
  // folder (Recents never reads placements).
  useEffect(() => {
    if (!folderView || initialPlacements) return
    let cancelled = false
    listRoomPlacements()
      .then((list) => {
        if (!cancelled) setPlacements(list)
      })
      .catch((err) => console.error("Failed to load placements", err))
    return () => {
      cancelled = true
    }
  }, [folderView, initialPlacements])

  // Surface fresh capture rounds on an already-open grid without a reload:
  // poll the per-Room thumbnail record and merge newer manifests in place. Gated
  // on having rooms so an empty grid never polls.
  useRoomThumbnailPoll(rooms.length > 0, setRooms)

  // roomId → the folder it's filed in for this user; absent = at the user's
  // root. Drives which Rooms surface in a folder view.
  const placementByRoom = useMemo(() => {
    const map = new Map<string, string>()
    for (const p of placements) map.set(p.roomId, p.folderId)
    return map
  }, [placements])

  const sortedRooms = useMemo(() => {
    if (!folderView) return sortRooms(rooms, sort, order)
    const placed = rooms.map((room) => ({
      room,
      name: room.name,
      createdAt: room.createdAt,
      lastConnectionAt: room.lastConnectionAt,
      folderId: placementByRoom.get(room.id) ?? null,
    }))
    return roomsInFolder(placed, currentFolderId, sort, order).map(
      (r) => r.room
    )
  }, [folderView, rooms, placementByRoom, currentFolderId, sort, order])

  // The sub-folders of the current folder (root when `currentFolderId` is null),
  // sharing the Room sort so both sections order the same way. Flat view shows
  // no folders.
  const sortedFolders = useMemo(
    () =>
      folderView ? foldersInParent(folders, currentFolderId, sort, order) : [],
    [folderView, folders, currentFolderId, sort, order]
  )

  // The breadcrumb trail, derived from the folder tree by walking parentFolderId
  // up to the root.
  const ancestors = useMemo(
    () => ancestorChain(folders, folderView ? currentFolderId : null),
    [folders, folderView, currentFolderId]
  )

  const createRoom = useCallback(
    async (name: string) => {
      const room = await createRoomAction(name)
      setRooms((prev) => [room, ...prev])
      // New canvas lands in the folder you're viewing (root needs no row).
      if (folderView && currentFolderId !== null) {
        await placeRoomAction(room.id, currentFolderId)
        setPlacements((prev) => [
          ...prev.filter((p) => p.roomId !== room.id),
          { roomId: room.id, folderId: currentFolderId },
        ])
      }
      return room
    },
    [folderView, currentFolderId]
  )

  const renameRoom = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim() || "Untitled"
    await renameRoomAction(id, trimmed)
    setRooms((prev) =>
      prev.map((r) => (r.id === id ? { ...r, name: trimmed } : r))
    )
  }, [])

  const removeRoom = useCallback(async (id: string) => {
    await deleteRoomAction(id)
    setRooms((prev) => prev.filter((r) => r.id !== id))
    // The placement row cascades away with the Room server-side; drop the local
    // copy too so a folder view doesn't keep counting it.
    setPlacements((prev) => prev.filter((p) => p.roomId !== id))
  }, [])

  const createFolder = useCallback(
    async (name: string) => {
      // New folders nest under the folder you're viewing (root when null).
      const parentFolderId = folderView ? currentFolderId : null
      const folder = await createFolderAction(name, parentFolderId)
      setFolders((prev) => [folder, ...prev])
      return folder
    },
    [folderView, currentFolderId]
  )

  const renameFolder = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim() || "Untitled folder"
    await renameFolderAction(id, trimmed)
    setFolders((prev) =>
      prev.map((f) => (f.id === id ? { ...f, name: trimmed } : f))
    )
  }, [])

  const value: HomeContextValue = {
    rooms: sortedRooms,
    folders: sortedFolders,
    folderView,
    currentFolderId,
    ancestors,
    loading,
    view,
    setView,
    sort,
    setSort,
    order,
    setOrder,
    createRoom,
    renameRoom,
    removeRoom,
    createFolder,
    renameFolder,
  }

  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>
}
