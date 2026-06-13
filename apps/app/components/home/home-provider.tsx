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
  deleteFolder as deleteFolderAction,
  listRoomPlacements,
  moveFolder as moveFolderAction,
  placeRoom as placeRoomAction,
  renameFolder as renameFolderAction,
  type FolderSummary,
  type RoomPlacementSummary,
} from "@/lib/folders-actions"
import {
  listPins,
  pinFolder as pinFolderAction,
  pinRoom as pinRoomAction,
  reorderPins as reorderPinsAction,
  unpin as unpinAction,
  type PinSummary,
} from "@/lib/pins-actions"
// `PinKind` lives in the server-only `@/lib/pins`; a type-only import is erased,
// so it never pulls that module (or its `server-only` guard) into the client
// bundle — and it sidesteps the "use server" re-export that breaks `next build`.
import type { PinKind } from "@/lib/pins"
import { sortRooms, type SortKey, type SortOrder } from "@/lib/room-sort"
import {
  ancestorChain,
  foldersInParent,
  roomsInFolder,
} from "@/lib/folder-tree"
import {
  collectFolderCascade,
  type CascadeRoom,
  type FolderCascade,
} from "@/lib/folder-cascade"
import { useRoomThumbnailPoll } from "./use-room-thumbnail-poll"

export type View = "grid" | "table"
export type { SortKey, SortOrder }
export type { PinKind, PinSummary }

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
  /**
   * Every folder the user owns, across all depths — the whole tree, unsorted.
   * The "Move to…" picker walks this to offer any folder as a destination
   * (`folders` is only the current level). Empty in the flat view.
   */
  allFolders: FolderSummary[]
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
  /** File a Room into a folder for this user (null = drop it back to root). */
  moveRoom: (roomId: string, folderId: string | null) => Promise<void>
  createFolder: (name: string) => Promise<FolderSummary>
  renameFolder: (id: string, name: string) => Promise<void>
  /**
   * What deleting a folder would entail — the descendant folders and the
   * per-Room outcomes — computed purely from the in-memory tree to drive the
   * delete confirm's counts (PRD #475, #488).
   */
  previewFolderDeletion: (id: string) => FolderCascade
  removeFolder: (id: string) => Promise<void>
  /** Re-parent a folder (null = move it to the root). */
  moveFolder: (folderId: string, parentFolderId: string | null) => Promise<void>

  /** The user's pins, ascending by position — what the sidebar's "Pinned"
   * section renders (PRD #507). */
  pins: PinSummary[]
  /**
   * Every Room the user can see, keyed by id. The pinned sidebar rows read a
   * Room's live name/owner through this, so a rename anywhere updates the pinned
   * row with no stale-state seam.
   */
  roomsById: Map<string, RoomSummary>
  /**
   * Every folder the user owns, keyed by id. The pinned sidebar rows read a
   * Folder's live name through this, so a rename anywhere updates the pinned row
   * with no stale-state seam — the Folder counterpart of `roomsById`.
   */
  foldersById: Map<string, FolderSummary>
  /** Whether the given target is currently pinned — drives the Pin/Unpin toggle. */
  isPinned: (kind: PinKind, id: string) => boolean
  /**
   * The folder a Room is filed in for this user (null = the user's root). The
   * pinned sidebar row reads this so its "Move to…" picker marks the Canvas's
   * real current home, independent of which folder view is on screen.
   */
  folderOfRoom: (roomId: string) => string | null
  /** Pin a Room to the sidebar (appends to the end); idempotent. */
  pinRoom: (roomId: string) => Promise<void>
  /**
   * Pin a Folder to the sidebar (appends to the end); idempotent. A shortcut,
   * not a move — the Folder stays where it lives in the tree.
   */
  pinFolder: (folderId: string) => Promise<void>
  /** Unpin a target from the sidebar. */
  unpin: (kind: PinKind, targetId: string) => Promise<void>
  /**
   * Persist a drag-chosen pin order. `ordered` is the whole pinned list in its
   * new order (one mixed run of Room and Folder pins); the provider applies it
   * optimistically, then reconciles with the persisted dense positions.
   */
  reorderPins: (ordered: { kind: PinKind; targetId: string }[]) => Promise<void>
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
  initialPins,
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
  initialPins?: PinSummary[]
  folderView?: boolean
  currentFolderId?: string | null
}) {
  const [rooms, setRooms] = useState<RoomSummary[]>(initialRooms ?? [])
  const [folders, setFolders] = useState<FolderSummary[]>(initialFolders ?? [])
  const [placements, setPlacements] = useState<RoomPlacementSummary[]>(
    initialPlacements ?? []
  )
  const [pins, setPins] = useState<PinSummary[]>(initialPins ?? [])
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

  // Pins drive the persistent sidebar on every home route, so seed them like
  // rooms; only fall back to a client fetch when the layout didn't provide them.
  useEffect(() => {
    if (initialPins) return
    let cancelled = false
    listPins()
      .then((list) => {
        if (!cancelled) setPins(list)
      })
      .catch((err) => console.error("Failed to load pins", err))
    return () => {
      cancelled = true
    }
  }, [initialPins])

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

  // Every Room the user can see, keyed by id — the live source the pinned
  // sidebar rows read a Room's name/owner from, so a rename or delete anywhere
  // flows straight through to the pinned row. Built from the unsorted Room
  // state (not the folder-scoped `sortedRooms`) so a pin resolves regardless of
  // which folder view is active.
  const roomsById = useMemo(() => {
    const map = new Map<string, RoomSummary>()
    for (const room of rooms) map.set(room.id, room)
    return map
  }, [rooms])

  // Every folder the user owns, keyed by id — the live source the pinned sidebar
  // rows read a Folder's name from, so a rename anywhere flows straight through.
  // Built from the full `folders` tree (server-seeded on every home route), so a
  // Folder pin resolves regardless of which folder view is active.
  const foldersById = useMemo(() => {
    const map = new Map<string, FolderSummary>()
    for (const folder of folders) map.set(folder.id, folder)
    return map
  }, [folders])

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
    // The pin row cascades away with the Room too; drop it locally so the
    // Pinned section doesn't keep a dangling row for a deleted Canvas.
    setPins((prev) =>
      prev.filter((p) => !(p.kind === "room" && p.targetId === id))
    )
  }, [])

  // File a Room under `folderId` (null = back to root) for this user. Mirrors
  // the placement bookkeeping `createRoom` does: a non-null target adds/replaces
  // the local placement row, null drops it — so the Room leaves or joins the
  // folder on screen without a reload. Per-user, so a shared Room's other
  // viewers are unaffected.
  const moveRoom = useCallback(
    async (roomId: string, folderId: string | null) => {
      await placeRoomAction(roomId, folderId)
      setPlacements((prev) => {
        const rest = prev.filter((p) => p.roomId !== roomId)
        return folderId === null ? rest : [...rest, { roomId, folderId }]
      })
    },
    []
  )

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

  // The delete cascade over the full in-memory tree: every Room the user can see
  // carries the same `isOwner`/`sharedWithCount` the deletion rule turns on, so
  // the confirm's counts come from the very collector the server re-runs. Rooms
  // at the user's root (no placement) sit in no folder and never join a branch.
  const previewFolderDeletion = useCallback(
    (id: string): FolderCascade => {
      const cascadeRooms: CascadeRoom[] = []
      for (const room of rooms) {
        const folderId = placementByRoom.get(room.id)
        if (folderId === undefined) continue
        cascadeRooms.push({
          roomId: room.id,
          folderId,
          isOwner: room.isOwner,
          sharedWithCount: room.sharedWithCount,
        })
      }
      return collectFolderCascade(id, folders, cascadeRooms)
    },
    [rooms, folders, placementByRoom]
  )

  const removeFolder = useCallback(async (id: string) => {
    const result = await deleteFolderAction(id)
    // Prune exactly what the server removed: the folder subtree, the Rooms it
    // tore down, and the Rooms the user left (gone from their view either
    // way). Placements under any deleted folder cascade away server-side, so
    // drop those locally too.
    const removedFolders = new Set(result.folderIds)
    const removedRooms = new Set([
      ...result.teardownRoomIds,
      ...result.leaveRoomIds,
    ])
    setFolders((prev) => prev.filter((f) => !removedFolders.has(f.id)))
    setRooms((prev) => prev.filter((r) => !removedRooms.has(r.id)))
    setPlacements((prev) => prev.filter((p) => !removedFolders.has(p.folderId)))
    // Pins for any removed Folder cascade away server-side; drop them locally so
    // the Pinned section doesn't keep a dangling row. The torn-down Rooms' pins
    // cascade too — a Room pin survives only if the Room itself does.
    setPins((prev) =>
      prev.filter((p) =>
        p.kind === "folder"
          ? !removedFolders.has(p.targetId)
          : !removedRooms.has(p.targetId)
      )
    )
  }, [])

  // Re-parent a folder (null = root). The server enforces the cycle guard and
  // owner checks; on success we patch the local parent so the moved folder
  // leaves the current level — falling out of `foldersInParent` for the view
  // it left — without a reload.
  const moveFolder = useCallback(
    async (folderId: string, parentFolderId: string | null) => {
      await moveFolderAction(folderId, parentFolderId)
      setFolders((prev) =>
        prev.map((f) => (f.id === folderId ? { ...f, parentFolderId } : f))
      )
    },
    []
  )

  // Pin a Room to the sidebar. Mirrors the room/folder mutations: await the
  // action, then patch local state — the server append is idempotent, so a
  // double-pin reconciles to the one pin the action returns rather than stacking
  // a row. Per-user, so a shared Room's other viewers are unaffected.
  const pinRoom = useCallback(async (roomId: string) => {
    const summary = await pinRoomAction(roomId)
    setPins((prev) =>
      prev.some(
        (p) => p.kind === summary.kind && p.targetId === summary.targetId
      )
        ? prev
        : [...prev, summary]
    )
  }, [])

  // Pin a Folder to the sidebar — the Folder counterpart of `pinRoom`. The
  // server append is idempotent, so a double-pin reconciles to the one pin the
  // action returns rather than stacking a row. A shortcut, not a move: the
  // Folder's placement in the tree is untouched.
  const pinFolder = useCallback(async (folderId: string) => {
    const summary = await pinFolderAction(folderId)
    setPins((prev) =>
      prev.some(
        (p) => p.kind === summary.kind && p.targetId === summary.targetId
      )
        ? prev
        : [...prev, summary]
    )
  }, [])

  const unpin = useCallback(async (kind: PinKind, targetId: string) => {
    await unpinAction(kind, targetId)
    setPins((prev) =>
      prev.filter((p) => !(p.kind === kind && p.targetId === targetId))
    )
  }, [])

  // Persist a drag-chosen pin order. Mirrors the other pin mutations but
  // optimistically *first*: Framer Motion's `Reorder` has already painted the
  // new order, so we reflect it into state immediately (assigning dense
  // positions by index, the same packing the server runs) rather than waiting
  // for the round-trip and snapping back. The action returns the persisted list,
  // which we then reconcile to — authoritative if a concurrent pin/unpin landed.
  const reorderPins = useCallback(
    async (ordered: { kind: PinKind; targetId: string }[]) => {
      setPins((prev) => {
        const byKey = new Map(
          prev.map((p) => [`${p.kind}:${p.targetId}`, p] as const)
        )
        const next: PinSummary[] = []
        ordered.forEach((o, index) => {
          const existing = byKey.get(`${o.kind}:${o.targetId}`)
          if (existing) next.push({ ...existing, position: index })
        })
        // Keep any pins the drag list didn't mention (e.g. one added in a
        // concurrent action) so the optimistic step never drops a row.
        const seen = new Set(ordered.map((o) => `${o.kind}:${o.targetId}`))
        for (const p of prev) {
          if (!seen.has(`${p.kind}:${p.targetId}`)) next.push(p)
        }
        return next
      })
      const persisted = await reorderPinsAction(ordered)
      setPins(persisted)
    },
    []
  )

  const isPinned = useCallback(
    (kind: PinKind, id: string) =>
      pins.some((p) => p.kind === kind && p.targetId === id),
    [pins]
  )

  const folderOfRoom = useCallback(
    (roomId: string) => placementByRoom.get(roomId) ?? null,
    [placementByRoom]
  )

  // The pinned rows render ascending by position — the order pins were added.
  const sortedPins = useMemo(
    () => [...pins].sort((a, b) => a.position - b.position),
    [pins]
  )

  const value: HomeContextValue = {
    rooms: sortedRooms,
    folders: sortedFolders,
    allFolders: folders,
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
    moveRoom,
    createFolder,
    renameFolder,
    previewFolderDeletion,
    removeFolder,
    moveFolder,
    pins: sortedPins,
    roomsById,
    foldersById,
    isPinned,
    folderOfRoom,
    pinRoom,
    pinFolder,
    unpin,
    reorderPins,
  }

  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>
}
