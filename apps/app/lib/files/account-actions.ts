"use server"

import { requireUserId } from "@/lib/auth-helpers"
import { accountFiles, canvasFiles } from "@/lib/files"
import { openRoom } from "@/lib/room-access"
import type { FileEntryData } from "@/lib/types"
import { saveAttachment } from "./attach"
import { MODEL_IMAGE_TYPES } from "./attachments"
import { baseName } from "./paths"

/** Your Account Files (Settings › Files, #1521), by path. */
export async function listAccountFiles(): Promise<FileEntryData[]> {
  const listed = await accountFiles(await requireUserId()).list()
  if (!listed.ok) throw new Error(listed.error)
  return listed.value
}

/**
 * Copy one of your Account Files' images into a canvas's files, under
 * `uploads/` like an upload, for a Document there to show: only you can read
 * your account's files, and everyone on the canvas should see the image.
 * Answers the copy's path.
 */
export async function copyAccountImageToCanvas(
  roomId: string,
  path: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const userId = await requireUserId()
  const room = await openRoom(roomId)
  const read = await accountFiles(userId).read(path)
  if (!read.ok || !MODEL_IMAGE_TYPES.has(read.value.entry.mediaType)) {
    return { ok: false, error: "That image isn’t in your files any more." }
  }
  const saved = await saveAttachment(canvasFiles(room), {
    name: baseName(read.value.entry.path),
    type: read.value.entry.mediaType,
    bytes: read.value.bytes,
    userId: room.userId,
  })
  return saved.ok ? { ok: true, path: saved.value.path } : saved
}
