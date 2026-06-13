"use server"

import { nanoid } from "nanoid"
import { requireUserId } from "@/lib/auth-helpers"
import {
  createFolder as createFolderRecord,
  listFoldersForUser,
} from "@/lib/folders"

// Server actions over folders, mirroring `lib/rooms-actions`. Every action gates
// on `requireUserId` and scopes to that user, so folders stay private per user
// (PRD #475). Works unchanged on the local build, where `requireUserId` resolves
// to the single seeded local user.

export type FolderSummary = {
  id: string
  name: string
  ownerId: string
  parentFolderId: string | null
  createdAt: number
  updatedAt: number
}

function toSummary(folder: {
  id: string
  name: string
  ownerId: string
  parentFolderId: string | null
  createdAt: number
  updatedAt: number
}): FolderSummary {
  return {
    id: folder.id,
    name: folder.name,
    ownerId: folder.ownerId,
    parentFolderId: folder.parentFolderId,
    createdAt: folder.createdAt,
    updatedAt: folder.updatedAt,
  }
}

export async function createFolder(
  name: string,
  parentFolderId: string | null = null
): Promise<FolderSummary> {
  const ownerId = await requireUserId()
  const trimmed = name.trim() || "Untitled folder"
  const id = nanoid(10)

  const folder = await createFolderRecord({
    id,
    name: trimmed,
    ownerId,
    parentFolderId,
  })
  return toSummary(folder)
}

export async function listFolders(): Promise<FolderSummary[]> {
  const ownerId = await requireUserId()
  const folders = await listFoldersForUser(ownerId)
  return folders.map(toSummary)
}
