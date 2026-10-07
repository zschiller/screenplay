"use server"

import { buildIdentity } from "@/lib/capabilities"
import { openRoom } from "@/lib/room-access"
import { canvasRepoEnv, type EnvDocFields } from "./canvas-repo-env"
import { migrateCanvasRepoEnv } from "./migrate"
import { kvCanvasRepoEnvStore } from "./store"

/**
 * The Canvas Repo env module (`./canvas-repo-env`, #1492) for the signed-in
 * member: each action opens the Canvas for them and runs one operation, which
 * stores the values and then records their names and digest in the room doc.
 * Values never go back to the client except through `revealCanvasRepoEnv`.
 */
async function openEnv(roomId: string) {
  const room = await openRoom(roomId)
  return canvasRepoEnv(room, kvCanvasRepoEnvStore, {
    userId: room.userId,
    role: room.role,
    localBuild: buildIdentity === "host",
  })
}

/** Save the Repo settings form's env vars: the whole set for whoever may
 *  reveal them, typed lines over the stored values for anyone else. */
export async function saveCanvasRepoEnv(
  roomId: string,
  repoId: string,
  text: string
): Promise<void> {
  await (await openEnv(roomId)).save(repoId, text)
}

/** Reset to Settings: the Repository's values replace this Canvas's. */
export async function resetCanvasRepoEnv(
  roomId: string,
  repoId: string,
  text: string
): Promise<void> {
  await (await openEnv(roomId)).reset(repoId, text)
}

/** Switching a Repository on: its values stored under the new Repo's id,
 *  and the names and digest its record starts with. */
export async function copyInCanvasRepoEnv(
  roomId: string,
  repoId: string,
  text: string
): Promise<EnvDocFields> {
  return (await openEnv(roomId)).copyIn(repoId, text)
}

/** A Canvas Repo's stored values, for the adder's edit form. */
export async function revealCanvasRepoEnv(
  roomId: string,
  repoId: string
): Promise<string> {
  return (await openEnv(roomId)).reveal(repoId)
}

/** Move this Canvas's legacy plain-text env vars out of its room doc
 *  (`migrateCanvasRepoEnv`). The Canvas calls it on load when it sees any. */
export async function migrateCanvasEnv(roomId: string): Promise<void> {
  const room = await openRoom(roomId)
  await migrateCanvasRepoEnv(room, kvCanvasRepoEnvStore)
}
