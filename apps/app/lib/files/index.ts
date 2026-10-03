import "server-only"

import { blobStoreChoiceFromEnv } from "@/lib/blob/select"
import type { RoomDoc } from "@/lib/room-access"
import { accountFilesOn, listFileIndex } from "./account-files"
import { kvAccountFileStore } from "./account-store"
import { canvasFilesOn } from "./canvas-files"
import type { Files } from "./files"
import { localFsFileStore } from "./local-fs"
import type { FileStore } from "./store"
import { vercelFileStore } from "./vercel"

/**
 * The private file store for this build, picked the way the blob store is
 * (`BLOB_STORE`): a private Vercel Blob store on hosted, local disk on the
 * desktop build.
 */
export const fileStore: FileStore =
  blobStoreChoiceFromEnv() === "local-fs"
    ? localFsFileStore()
    : vercelFileStore()

/** A Room's Canvas Files on this build's file store. */
export function canvasFiles(room: RoomDoc): Files {
  return canvasFilesOn(room, fileStore)
}

/** One person's Account Files (#1521) on this build's file store. */
export function accountFiles(userId: string): Files {
  return accountFilesOn(
    userId,
    listFileIndex(kvAccountFileStore(userId)),
    fileStore
  )
}
