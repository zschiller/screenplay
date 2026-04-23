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
  createProject,
  deleteProject,
  listProjects,
  renameProject,
  type ProjectSummary,
} from "@/lib/projects-actions"
import {
  cleanupMissingFiles,
  createFolder as createFolderAction,
  deleteFolder as deleteFolderAction,
  getOrganization,
  moveFile as moveFileAction,
  renameFolder as renameFolderAction,
  setFilePinned,
  setFolderPinned,
} from "@/lib/organization-actions"
import {
  DRAFTS_FOLDER_ID,
  type Folder,
  type OrganizationState,
} from "@/lib/organization"

export type View = "grid" | "table"
export type SortKey = "updated" | "created" | "name"

export const PINNED_VIEW_ID = "__pinned__"
export const ALL_VIEW_ID = "__all__"

type HomeContextValue = {
  files: ProjectSummary[]
  folders: Folder[]
  fileFolder: Record<string, string>
  pinnedFiles: Set<string>
  pinnedFolders: Set<string>
  loading: boolean
  selectedId: string
  setSelectedId: (id: string) => void
  view: View
  setView: (v: View) => void
  sort: SortKey
  setSort: (s: SortKey) => void

  filesInFolder: (folderId: string) => ProjectSummary[]
  filesInSelection: ProjectSummary[]
  selectionLabel: string
  isDraftsSelected: boolean

  createFile: (name: string, folderId: string) => Promise<ProjectSummary>
  renameFile: (id: string, name: string) => Promise<void>
  removeFile: (id: string) => Promise<void>
  moveFile: (fileId: string, folderId: string) => Promise<void>
  toggleFilePin: (id: string) => Promise<void>

  createFolder: (name: string) => Promise<Folder>
  renameFolder: (id: string, name: string) => Promise<void>
  removeFolder: (id: string) => Promise<void>
  toggleFolderPin: (id: string) => Promise<void>
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
  }
}

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const [files, setFiles] = useState<ProjectSummary[]>([])
  const [org, setOrg] = useState(() => applyOrg({
    folders: [],
    fileFolder: {},
    pinnedFiles: [],
    pinnedFolders: [],
  }))
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string>(DRAFTS_FOLDER_ID)
  const [view, setView] = useState<View>("grid")
  const [sort, setSort] = useState<SortKey>("updated")

  useEffect(() => {
    let cancelled = false
    Promise.all([listProjects(), getOrganization()])
      .then(async ([projectList, orgState]) => {
        if (cancelled) return
        const cleaned = await cleanupMissingFiles(
          projectList.map((p) => p.id),
        ).catch(() => orgState)
        if (cancelled) return
        setFiles(projectList)
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
      if (folderId === DRAFTS_FOLDER_ID) {
        return files.filter((f) => !org.fileFolder[f.id])
      }
      return files.filter((f) => org.fileFolder[f.id] === folderId)
    },
    [files, org.fileFolder],
  )

  const sortedSelection = useMemo(() => {
    let list: ProjectSummary[]
    if (selectedId === PINNED_VIEW_ID) {
      list = files.filter((f) => org.pinnedFiles.has(f.id))
    } else if (selectedId === ALL_VIEW_ID) {
      list = [...files]
    } else {
      list = filesInFolder(selectedId)
    }

    const sorted = [...list]
    if (sort === "name") {
      sorted.sort((a, b) => a.name.localeCompare(b.name))
    } else if (sort === "created") {
      sorted.sort((a, b) => b.createdAt - a.createdAt)
    } else {
      sorted.sort((a, b) => {
        const aTs = a.lastConnectionAt ?? a.createdAt
        const bTs = b.lastConnectionAt ?? b.createdAt
        return bTs - aTs
      })
    }
    return sorted
  }, [files, filesInFolder, selectedId, org.pinnedFiles, sort])

  const selectionLabel = useMemo(() => {
    if (selectedId === PINNED_VIEW_ID) return "Pinned"
    if (selectedId === ALL_VIEW_ID) return "All files"
    if (selectedId === DRAFTS_FOLDER_ID) return "Drafts"
    return org.folders.find((f) => f.id === selectedId)?.name ?? "Folder"
  }, [selectedId, org.folders])

  const createFile = useCallback(
    async (name: string, folderId: string) => {
      const file = await createProject(name)
      setFiles((prev) => [file, ...prev])
      if (folderId !== DRAFTS_FOLDER_ID) {
        const next = await moveFileAction(file.id, folderId)
        setOrg(applyOrg(next))
      }
      return file
    },
    [],
  )

  const renameFile = useCallback(async (id: string, name: string) => {
    const trimmed = name.trim() || "Untitled"
    await renameProject(id, trimmed)
    setFiles((prev) =>
      prev.map((p) => (p.id === id ? { ...p, name: trimmed } : p)),
    )
  }, [])

  const removeFile = useCallback(async (id: string) => {
    await deleteProject(id)
    setFiles((prev) => prev.filter((p) => p.id !== id))
    const next = await cleanupMissingFiles(
      files.filter((f) => f.id !== id).map((f) => f.id),
    ).catch(() => null)
    if (next) setOrg(applyOrg(next))
  }, [files])

  const moveFile = useCallback(async (fileId: string, folderId: string) => {
    const next = await moveFileAction(fileId, folderId)
    setOrg(applyOrg(next))
  }, [])

  const toggleFilePin = useCallback(
    async (id: string) => {
      const next = await setFilePinned(id, !org.pinnedFiles.has(id))
      setOrg(applyOrg(next))
    },
    [org.pinnedFiles],
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
    [selectedId],
  )

  const toggleFolderPin = useCallback(
    async (id: string) => {
      const next = await setFolderPinned(id, !org.pinnedFolders.has(id))
      setOrg(applyOrg(next))
    },
    [org.pinnedFolders],
  )

  const value: HomeContextValue = {
    files,
    folders: org.folders,
    fileFolder: org.fileFolder,
    pinnedFiles: org.pinnedFiles,
    pinnedFolders: org.pinnedFolders,
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
  }

  return <HomeContext.Provider value={value}>{children}</HomeContext.Provider>
}
