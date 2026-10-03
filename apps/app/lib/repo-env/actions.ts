"use server"

import { isLocalBuild } from "@/lib/local-mode"
import { openRoom } from "@/lib/room-access"
import type { RepoData } from "@/lib/types"
import { migrateCanvasRepoEnv } from "./migrate"
import { canRevealEnv, mergeEnvVars } from "./names"
import { envDocFields, kvCanvasRepoEnvStore, loadCanvasRepoEnv } from "./store"

/** What the Canvas writes into its Repo record after a save. */
export type EnvDocFields = Pick<RepoData, "envVarNames" | "envVarsDigest">

/**
 * Save a Canvas Repo's env var values (#1416). Any member who can edit the Canvas can: `replace`
 * stores `text` as the whole set (the adder after revealing, or the add
 * flow), `merge` lays the typed lines over the stored values (a member who
 * can't see them setting their own). Returns the names and digest for the
 * caller to write into the room doc; the values never go there.
 */
export async function saveCanvasRepoEnv(
  roomId: string,
  repoId: string,
  text: string,
  mode: "replace" | "merge"
): Promise<EnvDocFields> {
  const room = await openRoom(roomId)
  if (room.role === "viewer") throw new Error("Viewers can't change settings")
  let next = text
  if (mode === "merge") {
    const repo = await room.readDoc(({ repos }) => repos.get(repoId))
    const stored = await loadCanvasRepoEnv(
      kvCanvasRepoEnvStore,
      roomId,
      repo ?? { id: repoId }
    )
    next = mergeEnvVars(stored, text)
  }
  await kvCanvasRepoEnvStore.set(roomId, repoId, next)
  const { envVarNames, envVarsDigest } = envDocFields(next)
  return { envVarNames, envVarsDigest }
}

/**
 * A Canvas Repo's stored values, for its edit form. Only whoever
 * {@link canRevealEnv} allows: other members get an error and keep seeing
 * names only.
 */
export async function revealCanvasRepoEnv(
  roomId: string,
  repoId: string
): Promise<string> {
  const room = await openRoom(roomId)
  const repo = await room.readDoc(({ repos }) => repos.get(repoId))
  if (!repo) throw new Error("Repository not found")
  const allowed = canRevealEnv(repo, {
    userId: room.userId,
    isOwner: room.role === "owner",
    localBuild: isLocalBuild,
  })
  if (!allowed) {
    throw new Error(
      "Only the person who added this repository can see its values"
    )
  }
  return loadCanvasRepoEnv(kvCanvasRepoEnvStore, roomId, repo)
}

/** Move this Canvas's legacy plain-text env vars out of its room doc
 *  (`migrateCanvasRepoEnv`). The Canvas calls it on load when it sees any. */
export async function migrateCanvasEnv(roomId: string): Promise<void> {
  const room = await openRoom(roomId)
  await migrateCanvasRepoEnv(room, kvCanvasRepoEnvStore)
}
