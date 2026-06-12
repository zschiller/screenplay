"use server"

import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"
import { requireUserId } from "@/lib/auth-helpers"
import { db, schema } from "@/lib/db"
import {
  DRAFTS_FOLDER_ID,
  type Folder,
  type OrganizationState,
} from "./organization"

const EMPTY: OrganizationState = {
  folders: [],
  fileFolder: {},
  pinnedFiles: [],
  pinnedFolders: [],
  fileOrder: {},
  openFolders: [],
}

function normalize(raw: unknown): OrganizationState {
  if (!raw || typeof raw !== "object") return { ...EMPTY }
  const source = raw as Partial<OrganizationState>
  return {
    folders: Array.isArray(source.folders)
      ? source.folders.filter(
          (f): f is Folder =>
            !!f &&
            typeof f === "object" &&
            typeof f.id === "string" &&
            typeof f.name === "string" &&
            typeof f.createdAt === "number"
        )
      : [],
    fileFolder:
      source.fileFolder && typeof source.fileFolder === "object"
        ? Object.fromEntries(
            Object.entries(source.fileFolder).filter(
              ([, v]) => typeof v === "string"
            )
          )
        : {},
    pinnedFiles: Array.isArray(source.pinnedFiles)
      ? source.pinnedFiles.filter((v): v is string => typeof v === "string")
      : [],
    pinnedFolders: Array.isArray(source.pinnedFolders)
      ? source.pinnedFolders.filter((v): v is string => typeof v === "string")
      : [],
    fileOrder:
      source.fileOrder && typeof source.fileOrder === "object"
        ? Object.fromEntries(
            Object.entries(source.fileOrder)
              .filter(([, v]) => Array.isArray(v))
              .map(([k, v]) => [
                k,
                (v as unknown[]).filter(
                  (id): id is string => typeof id === "string"
                ),
              ])
          )
        : {},
    openFolders: Array.isArray(source.openFolders)
      ? source.openFolders.filter((v): v is string => typeof v === "string")
      : [],
  }
}

async function readState(userId: string): Promise<OrganizationState> {
  const rows = await db
    .select({ organization: schema.user.organization })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1)
  return normalize(rows[0]?.organization)
}

async function writeState(
  userId: string,
  next: OrganizationState
): Promise<OrganizationState> {
  await db
    .update(schema.user)
    .set({ organization: next, updatedAt: new Date() })
    .where(eq(schema.user.id, userId))
  return next
}

export async function getOrganization(): Promise<OrganizationState> {
  const userId = await requireUserId()
  return readState(userId)
}

export async function createFolder(name: string): Promise<OrganizationState> {
  const userId = await requireUserId()
  const trimmed = name.trim() || "Untitled"
  const state = await readState(userId)
  const folder: Folder = {
    id: nanoid(10),
    name: trimmed,
    createdAt: Date.now(),
  }
  return writeState(userId, {
    ...state,
    folders: [...state.folders, folder],
  })
}

export async function renameFolder(
  folderId: string,
  name: string
): Promise<OrganizationState> {
  const userId = await requireUserId()
  if (folderId === DRAFTS_FOLDER_ID) {
    throw new Error("Drafts cannot be renamed")
  }
  const trimmed = name.trim() || "Untitled"
  const state = await readState(userId)
  return writeState(userId, {
    ...state,
    folders: state.folders.map((f) =>
      f.id === folderId ? { ...f, name: trimmed } : f
    ),
  })
}

export async function deleteFolder(
  folderId: string
): Promise<OrganizationState> {
  const userId = await requireUserId()
  if (folderId === DRAFTS_FOLDER_ID) {
    throw new Error("Drafts cannot be deleted")
  }
  const state = await readState(userId)
  const fileFolder: Record<string, string> = {}
  for (const [fileId, fId] of Object.entries(state.fileFolder)) {
    if (fId !== folderId) fileFolder[fileId] = fId
  }
  const fileOrder = { ...state.fileOrder }
  delete fileOrder[folderId]
  return writeState(userId, {
    ...state,
    folders: state.folders.filter((f) => f.id !== folderId),
    fileFolder,
    pinnedFolders: state.pinnedFolders.filter((id) => id !== folderId),
    fileOrder,
    openFolders: state.openFolders.filter((id) => id !== folderId),
  })
}

/** Persist whether a folder is expanded in the home sidebar. */
export async function setFolderOpen(
  folderId: string,
  open: boolean
): Promise<OrganizationState> {
  const userId = await requireUserId()
  const state = await readState(userId)
  const set = new Set(state.openFolders)
  if (open) set.add(folderId)
  else set.delete(folderId)
  return writeState(userId, {
    ...state,
    openFolders: Array.from(set),
  })
}

/**
 * Persist the sidebar display order of folders. Ids not in `orderedIds`
 * (e.g. created concurrently) keep their relative order after the ordered
 * ones; unknown ids are ignored.
 */
export async function reorderFolders(
  orderedIds: string[]
): Promise<OrganizationState> {
  const userId = await requireUserId()
  const state = await readState(userId)
  const byId = new Map(state.folders.map((f) => [f.id, f]))
  const folders: Folder[] = []
  for (const id of orderedIds) {
    const folder = byId.get(id)
    if (folder) {
      folders.push(folder)
      byId.delete(id)
    }
  }
  for (const folder of state.folders) {
    if (byId.has(folder.id)) folders.push(folder)
  }
  return writeState(userId, { ...state, folders })
}

/**
 * Persist the manual file order within one folder. Ids not currently filed
 * in the folder are dropped, so a stale client can't smuggle files across
 * folders through a reorder.
 */
export async function reorderFolderFiles(
  folderId: string,
  orderedIds: string[]
): Promise<OrganizationState> {
  const userId = await requireUserId()
  const state = await readState(userId)
  if (!state.folders.some((f) => f.id === folderId)) {
    throw new Error("Folder not found")
  }
  const filed = orderedIds.filter((id) => state.fileFolder[id] === folderId)
  return writeState(userId, {
    ...state,
    fileOrder: { ...state.fileOrder, [folderId]: filed },
  })
}

export async function moveFile(
  fileId: string,
  folderId: string,
  /**
   * Complete new file order for the target folder (the client knows the
   * display order; the server doesn't). Omitted → the file lands after the
   * folder's ordered files.
   */
  orderedIds?: string[]
): Promise<OrganizationState> {
  const userId = await requireUserId()
  const state = await readState(userId)
  const fileFolder = { ...state.fileFolder }
  if (folderId === DRAFTS_FOLDER_ID) {
    delete fileFolder[fileId]
  } else {
    const exists = state.folders.some((f) => f.id === folderId)
    if (!exists) throw new Error("Folder not found")
    fileFolder[fileId] = folderId
  }
  // The file leaves its old folder's manual order; it joins the target's
  // order only when the caller placed it somewhere specific.
  const fileOrder: Record<string, string[]> = {}
  for (const [fId, list] of Object.entries(state.fileOrder)) {
    fileOrder[fId] = list.filter((id) => id !== fileId)
  }
  if (folderId !== DRAFTS_FOLDER_ID && orderedIds) {
    fileOrder[folderId] = orderedIds.filter((id) => fileFolder[id] === folderId)
  }
  return writeState(userId, { ...state, fileFolder, fileOrder })
}

export async function setFilePinned(
  fileId: string,
  pinned: boolean
): Promise<OrganizationState> {
  const userId = await requireUserId()
  const state = await readState(userId)
  const set = new Set(state.pinnedFiles)
  if (pinned) set.add(fileId)
  else set.delete(fileId)
  return writeState(userId, {
    ...state,
    pinnedFiles: Array.from(set),
  })
}

export async function setFolderPinned(
  folderId: string,
  pinned: boolean
): Promise<OrganizationState> {
  const userId = await requireUserId()
  if (folderId === DRAFTS_FOLDER_ID) {
    throw new Error("Drafts cannot be pinned")
  }
  const state = await readState(userId)
  const set = new Set(state.pinnedFolders)
  if (pinned) set.add(folderId)
  else set.delete(folderId)
  return writeState(userId, {
    ...state,
    pinnedFolders: Array.from(set),
  })
}

export async function cleanupMissingFiles(
  existingFileIds: string[]
): Promise<OrganizationState> {
  const userId = await requireUserId()
  const state = await readState(userId)
  const existing = new Set(existingFileIds)
  const fileFolder: Record<string, string> = {}
  for (const [fileId, folderId] of Object.entries(state.fileFolder)) {
    if (existing.has(fileId)) fileFolder[fileId] = folderId
  }
  const pinnedFiles = state.pinnedFiles.filter((id) => existing.has(id))
  const fileOrder: Record<string, string[]> = {}
  let orderPruned = false
  for (const [folderId, list] of Object.entries(state.fileOrder)) {
    const kept = list.filter((id) => existing.has(id))
    fileOrder[folderId] = kept
    if (kept.length !== list.length) orderPruned = true
  }
  if (
    pinnedFiles.length === state.pinnedFiles.length &&
    Object.keys(fileFolder).length === Object.keys(state.fileFolder).length &&
    !orderPruned
  ) {
    return state
  }
  return writeState(userId, { ...state, fileFolder, pinnedFiles, fileOrder })
}
