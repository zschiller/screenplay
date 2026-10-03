import "server-only"

import { fileStore } from "@/lib/files"
import { readRoomFileEntries, roomFileIndex } from "@/lib/files/canvas-files"
import type { FileStore } from "@/lib/files/store"
import type { RoomDoc, RoomReader } from "@/lib/room-access"

import {
  createSavedSkills,
  savedSkillsIn,
  type SavedSkill,
  type SavedSkills,
} from "./saved"

/**
 * **Canvas Skills** (#1555): Skills any chat on a canvas saved, shared with
 * its members. Their file entries live in the Room's Y.Doc (`skills`, apart
 * from Canvas Files, so they never show in the Files tree); their bytes live
 * in the private file store under `canvas/<roomId>/skills/`.
 */
export function canvasSkillsOn(room: RoomDoc, store: FileStore): SavedSkills {
  return createSavedSkills({
    index: roomFileIndex(room, "skills"),
    store,
    keyPrefix: `canvas/${room.roomId}/skills`,
  })
}

/** A Room's Canvas Skills on this build's file store. */
export function canvasSkills(room: RoomDoc): SavedSkills {
  return canvasSkillsOn(room, fileStore)
}

/**
 * Canvas Skills for a turn's merged index. A read that fails leaves the turn
 * without them rather than failing it.
 */
export async function loadCanvasSkills(
  room: RoomReader
): Promise<SavedSkill[]> {
  return (
    (await room
      .readDoc((c) => savedSkillsIn(readRoomFileEntries(c, "skills")))
      .catch(() => null)) ?? []
  )
}
