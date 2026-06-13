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
import { sortRooms, type SortKey } from "@/lib/room-sort"

export type View = "grid" | "table"
export type { SortKey }

type HomeContextValue = {
  /** Every Room the user owns or can see, ordered by the current sort. */
  rooms: RoomSummary[]
  loading: boolean
  view: View
  setView: (v: View) => void
  sort: SortKey
  setSort: (s: SortKey) => void

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

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const [rooms, setRooms] = useState<RoomSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>("grid")
  const [sort, setSort] = useState<SortKey>("updated")

  useEffect(() => {
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
  }, [])

  const sortedRooms = useMemo(() => sortRooms(rooms, sort), [rooms, sort])

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
    createRoom,
    renameRoom,
    removeRoom,
  }

  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>
}
