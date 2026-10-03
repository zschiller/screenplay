"use server"

import { openRoom } from "@/lib/room-access"

import { canvasSkills } from "./canvas"
import type { OpenedSkill } from "./saved"

/**
 * Read one of the canvas's Skills for Open. Any member may; a non-member is
 * refused before the doc is read.
 */
export async function readCanvasSkill(
  roomId: string,
  name: string
): Promise<OpenedSkill> {
  const read = await canvasSkills(await openRoom(roomId)).read(name)
  if (!read.ok) throw new Error(read.error)
  return { content: read.value.content, files: read.value.files }
}

/**
 * Delete one of the canvas's Skills, with everything in its folder. Viewers
 * can't; the list updates live from the Room's doc.
 */
export async function deleteCanvasSkill(
  roomId: string,
  name: string
): Promise<void> {
  const room = await openRoom(roomId)
  if (room.role === "viewer") {
    throw new Error("Viewers can't delete skills on this canvas.")
  }
  const removed = await canvasSkills(room).remove(name)
  if (!removed.ok) throw new Error(removed.error)
}
