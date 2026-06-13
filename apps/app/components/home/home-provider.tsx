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
import { sortRooms, type SortKey, type SortOrder } from "@/lib/room-sort"
import { useRoomThumbnailPoll } from "./use-room-thumbnail-poll"

export type View = "grid" | "table"
export type { SortKey, SortOrder }

/** A→Z reads as the natural default for names; everything else newest-first. */
export function defaultOrder(sort: SortKey): SortOrder {
  return sort === "name" ? "asc" : "desc"
}

type HomeContextValue = {
  /** Every Room the user owns or can see, ordered by the current sort. */
  rooms: RoomSummary[]
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
}: {
  children: React.ReactNode
  initialRooms?: RoomSummary[]
}) {
  const [rooms, setRooms] = useState<RoomSummary[]>(initialRooms ?? [])
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

  // Surface fresh capture rounds on an already-open grid without a reload:
  // poll the per-Room thumbnail record and merge newer manifests in place. Gated
  // on having rooms so an empty grid never polls.
  useRoomThumbnailPoll(rooms.length > 0, setRooms)

  const sortedRooms = useMemo(
    () => sortRooms(rooms, sort, order),
    [rooms, sort, order]
  )

  const createRoom = useCallback(async (name: string) => {
    const room = await createRoomAction(name)
    setRooms((prev) => [room, ...prev])
    return room
  }, [])

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
  }, [])

  const value: HomeContextValue = {
    rooms: sortedRooms,
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
  }

  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>
}
