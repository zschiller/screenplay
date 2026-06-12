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
  createRoom,
  deleteRoom,
  listRooms,
  renameRoom,
  type RoomSummary,
} from "@/lib/rooms-actions"
import {
  cleanupMissingFiles,
  createFolder as createFolderAction,
  deleteFolder as deleteFolderAction,
  getOrganization,
  moveFile as moveFileAction,
  renameFolder as renameFolderAction,
  reorderFolderFiles as reorderFolderFilesAction,
  reorderFolders as reorderFoldersAction,
  setFilePinned,
  setFolderOpen as setFolderOpenAction,
  setFolderPinned,
} from "@/lib/organization-actions"
import {
  DRAFTS_FOLDER_ID,
  type Folder,
  type OrganizationState,
} from "@/lib/organization"
import { sortRooms, type SortKey } from "@/lib/room-sort"

export type View = "grid" | "table"
export type { SortKey }

export const PINNED_VIEW_ID = "__pinned__"
export const ALL_VIEW_ID = "__all__"

type HomeContextValue = {
  files: RoomSummary[]
  folders: Folder[]
  fileFolder: Record<string, string>
  pinnedFiles: Set<string>
  pinnedFolders: Set<string>
  /** Folders currently expanded in the sidebar (persisted per user). */
  openFolders: Set<string>
  setFolderOpen: (id: string, open: boolean) => Promise<void>
  loading: boolean
  selectedId: string
  setSelectedId: (id: string) => void
  view: View
  setView: (v: View) => void
  sort: SortKey
  setSort: (s: SortKey) => void

  filesInFolder: (folderId: string) => RoomSummary[]
  filesInSelection: RoomSummary[]
  selectionLabel: string
  isDraftsSelected: boolean

  createFile: (name: string, folderId: string) => Promise<RoomSummary>
  renameFile: (id: string, name: string) => Promise<void>
  removeFile: (id: string) => Promise<void>
  /** `orderedIds` is the target folder's complete new file order (optional). */
  moveFile: (
    fileId: string,
    folderId: string,
    orderedIds?: string[]
  ) => Promise<void>
  toggleFilePin: (id: string) => Promise<void>

  createFolder: (name: string) => Promise<Folder>
  renameFolder: (id: string, name: string) => Promise<void>
  removeFolder: (id: string) => Promise<void>
  toggleFolderPin: (id: string) => Promise<void>
  /** Persist sidebar folder order (drag-to-reorder). */
  reorderFolders: (orderedIds: string[]) => Promise<void>
  /** Persist the manual file order within one folder. */
  reorderFilesInFolder: (
    folderId: string,
    orderedIds: string[]
  ) => Promise<void>
}

const HomeContext = createContext<HomeContextValue | null>(null)

export function useHome(): HomeContextValue {
  const ctx = useContext(HomeContext)
  if (!ctx) throw new Error("useHome must be used within HomeProvider")
  return ctx
}

function applyOrg(state: OrganizationState) {
  return {
    folders: state.folders,
    fileFolder: state.fileFolder,
    pinnedFiles: new Set(state.pinnedFiles),
    pinnedFolders: new Set(state.pinnedFolders),
    fileOrder: state.fileOrder,
    openFolders: new Set(state.openFolders),
  }
}

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const [files, setFiles] = useState<RoomSummary[]>([])
  const [org, setOrg] = useState(() =>
    applyOrg({
      folders: [],
      fileFolder: {},
      pinnedFiles: [],
      pinnedFolders: [],
      fileOrder: {},
      openFolders: [],
    })
  )
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string>(DRAFTS_FOLDER_ID)
  const [view, setView] = useState<View>("grid")
  const [sort, setSort] = useState<SortKey>("updated")

  useEffect(() => {
    let cancelled = false
    Promise.all([listRooms(), getOrganization()])
      .then(async ([roomList, orgState]) => {
        if (cancelled) return
        const cleaned = await cleanupMissingFiles(
          roomList.map((p) => p.id)
        ).catch(() => orgState)
        if (cancelled) return
        setFiles(roomList)
        setOrg(applyOrg(cleaned))
      })
      .catch((err) => console.error("Failed to load home data", err))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const filesInFolder = useCallback(
    (folderId: string) => {
      const list =
        folderId === DRAFTS_FOLDER_ID
          ? files.filter((f) => !org.fileFolder[f.id])
          : files.filter((f) => org.fileFolder[f.id] === folderId)
      const order = org.fileOrder[folderId]
      if (!order || order.length === 0) return list
      // Manually ordered files first (by their dragged position), the rest
      // after in their natural order — same rule as the room sidebar's
      // sortForSidebar. Array.prototype.sort is stable, so returning 0
      // preserves the natural order for never-dragged files.
      const pos = new Map(order.map((id, i) => [id, i]))
      return [...list].sort((a, b) => {
        const pa = pos.get(a.id)
        const pb = pos.get(b.id)
        if (pa !== undefined && pb !== undefined) return pa - pb
        if (pa !== undefined) return -1
        if (pb !== undefined) return 1
        return 0
      })
    },
    [files, org.fileFolder, org.fileOrder]
  )

  const sortedSelection = useMemo(() => {
    let list: RoomSummary[]
    if (selectedId === PINNED_VIEW_ID) {
      list = files.filter((f) => org.pinnedFiles.has(f.id))
    } else if (selectedId === ALL_VIEW_ID) {
      list = [...files]
    } else {
      list = filesInFolder(selectedId)
    }

    return sortRooms(list, sort)
  }, [files, filesInFolder, selectedId, org.pinnedFiles, sort])

  const selectionLabel = useMemo(() => {
    if (selectedId === PINNED_VIEW_ID) return "Pinned"
    if (selectedId === ALL_VIEW_ID) return "All files"
    if (selectedId === DRAFTS_FOLDER_ID) return "Drafts"
    return org.folders.find((f) => f.id === selectedId)?.name ?? "Folder"
  }, [selectedId, org.folders])

  const createFile = useCallback(async (name: string, folderId: string) => {
    const file = await createRoom(name)
    setFiles((prev) => [file, ...prev])
    if (folderId !== DRAFTS_FOLDER_ID) {
      const next = await moveFileAction(file.id, folderId)
      setOrg(applyOrg(next))
    }
    return file
  }, [])

  const renameFile = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim() || "Untitled"
    await renameRoom(id, trimmed)
    setFiles((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p))
    )
  }, [])

  const removeFile = useCallback(
    async (id: string) => {
      await deleteRoom(id)
      setFiles((prev) => prev.filter((p) => p.id !== id))
      const next = await cleanupMissingFiles(
        files.filter((f) => f.id !== id).map((f) => f.id)
      ).catch(() => null)
      if (next) setOrg(applyOrg(next))
    },
    [files]
  )

  // The drag-and-drop mutators apply optimistically so the drop commits the
  // instant the pointer lifts (matching the room sidebar's Y.Doc-backed
  // immediacy), then reconcile with the server's authoritative state.
  const moveFile = useCallback(
    async (fileId: string, folderId: string, orderedIds?: string[]) => {
      setOrg((prev) => {
        const fileFolder = { ...prev.fileFolder }
        if (folderId === DRAFTS_FOLDER_ID) delete fileFolder[fileId]
        else fileFolder[fileId] = folderId
        const fileOrder: Record<string, string[]> = {}
        for (const [fId, list] of Object.entries(prev.fileOrder)) {
          fileOrder[fId] = list.filter((id) => id !== fileId)
        }
        if (folderId !== DRAFTS_FOLDER_ID && orderedIds) {
          fileOrder[folderId] = orderedIds
        }
        return { ...prev, fileFolder, fileOrder }
      })
      const next = await moveFileAction(fileId, folderId, orderedIds)
      setOrg(applyOrg(next))
    },
    []
  )

  const reorderFolders = useCallback(async (orderedIds: string[]) => {
    setOrg((prev) => {
      const byId = new Map(prev.folders.map((f) => [f.id, f]))
      const folders: Folder[] = []
      for (const id of orderedIds) {
        const folder = byId.get(id)
        if (folder) {
          folders.push(folder)
          byId.delete(id)
        }
      }
      for (const folder of prev.folders) {
        if (byId.has(folder.id)) folders.push(folder)
      }
      return { ...prev, folders }
    })
    const next = await reorderFoldersAction(orderedIds)
    setOrg(applyOrg(next))
  }, [])

  const reorderFilesInFolder = useCallback(
    async (folderId: string, orderedIds: string[]) => {
      setOrg((prev) => ({
        ...prev,
        fileOrder: { ...prev.fileOrder, [folderId]: orderedIds },
      }))
      const next = await reorderFolderFilesAction(folderId, orderedIds)
      setOrg(applyOrg(next))
    },
    []
  )

  const toggleFilePin = useCallback(
    async (id: string) => {
      const next = await setFilePinned(id, !org.pinnedFiles.has(id))
      setOrg(applyOrg(next))
    },
    [org.pinnedFiles]
  )

  const createFolder = useCallback(async (name: string) => {
    const next = await createFolderAction(name)
    setOrg(applyOrg(next))
    return next.folders[next.folders.length - 1]!
  }, [])

  const renameFolder = useCallback(async (id: string, name: string) => {
    const next = await renameFolderAction(id, name)
    setOrg(applyOrg(next))
  }, [])

  const removeFolder = useCallback(
    async (id: string) => {
      const next = await deleteFolderAction(id)
      setOrg(applyOrg(next))
      if (selectedId === id) setSelectedId(DRAFTS_FOLDER_ID)
    },
    [selectedId]
  )

  const toggleFolderPin = useCallback(
    async (id: string) => {
      const next = await setFolderPinned(id, !org.pinnedFolders.has(id))
      setOrg(applyOrg(next))
    },
    [org.pinnedFolders]
  )

  // Optimistic, and deliberately NOT reconciled with the server response:
  // expanding a folder must never flicker shut while a slow round-trip for an
  // earlier toggle resolves. The server state catches up on the next load.
  const setFolderOpen = useCallback(async (id: string, open: boolean) => {
    setOrg((prev) => {
      const openFolders = new Set(prev.openFolders)
      if (open) openFolders.add(id)
      else openFolders.delete(id)
      return { ...prev, openFolders }
    })
    await setFolderOpenAction(id, open)
  }, [])

  const value: HomeContextValue = {
    files,
    folders: org.folders,
    fileFolder: org.fileFolder,
    pinnedFiles: org.pinnedFiles,
    pinnedFolders: org.pinnedFolders,
    openFolders: org.openFolders,
    setFolderOpen,
    loading,
    selectedId,
    setSelectedId,
    view,
    setView,
    sort,
    setSort,
    filesInFolder,
    filesInSelection: sortedSelection,
    selectionLabel,
    isDraftsSelected: selectedId === DRAFTS_FOLDER_ID,
    createFile,
    renameFile,
    removeFile,
    moveFile,
    toggleFilePin,
    createFolder,
    renameFolder,
    removeFolder,
    toggleFolderPin,
    reorderFolders,
    reorderFilesInFolder,
  }

  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>
}
