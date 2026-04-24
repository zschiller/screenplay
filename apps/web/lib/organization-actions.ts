"use server"

import { nanoid } from "nanoid"
import { query } from "./db"
import { requireUserId } from "./auth-server"
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
            typeof f.createdAt === "number",
        )
      : [],
    fileFolder:
      source.fileFolder && typeof source.fileFolder === "object"
        ? Object.fromEntries(
            Object.entries(source.fileFolder).filter(
              ([, v]) => typeof v === "string",
            ),
          )
        : {},
    pinnedFiles: Array.isArray(source.pinnedFiles)
      ? source.pinnedFiles.filter((v): v is string => typeof v === "string")
      : [],
    pinnedFolders: Array.isArray(source.pinnedFolders)
      ? source.pinnedFolders.filter((v): v is string => typeof v === "string")
      : [],
  }
}

async function readState(userId: string): Promise<OrganizationState> {
  const { rows } = await query<{ data: unknown }>(
    `SELECT data FROM user_organization WHERE user_id = $1 LIMIT 1`,
    [userId],
  )
  return normalize(rows[0]?.data)
}

async function writeState(
  userId: string,
  next: OrganizationState,
): Promise<OrganizationState> {
  await query(
    `INSERT INTO user_organization (user_id, data, updated_at)
     VALUES ($1, $2::jsonb, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET data = EXCLUDED.data, updated_at = NOW()`,
    [userId, JSON.stringify(next)],
  )
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
  name: string,
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
      f.id === folderId ? { ...f, name: trimmed } : f,
    ),
  })
}

export async function deleteFolder(
  folderId: string,
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
  return writeState(userId, {
    ...state,
    folders: state.folders.filter((f) => f.id !== folderId),
    fileFolder,
    pinnedFolders: state.pinnedFolders.filter((id) => id !== folderId),
  })
}

export async function moveFile(
  fileId: string,
  folderId: string,
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
  return writeState(userId, { ...state, fileFolder })
}

export async function setFilePinned(
  fileId: string,
  pinned: boolean,
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
  pinned: boolean,
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
  existingFileIds: string[],
): Promise<OrganizationState> {
  const userId = await requireUserId()
  const state = await readState(userId)
  const existing = new Set(existingFileIds)
  const fileFolder: Record<string, string> = {}
  for (const [fileId, folderId] of Object.entries(state.fileFolder)) {
    if (existing.has(fileId)) fileFolder[fileId] = folderId
  }
  const pinnedFiles = state.pinnedFiles.filter((id) => existing.has(id))
  if (
    pinnedFiles.length === state.pinnedFiles.length &&
    Object.keys(fileFolder).length === Object.keys(state.fileFolder).length
  ) {
    return state
  }
  return writeState(userId, { ...state, fileFolder, pinnedFiles })
}
