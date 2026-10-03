"use server"

import { nanoid } from "nanoid"
import { requireUserId } from "@/lib/auth-helpers"
import { hasFixtureFault } from "@/lib/fixture-faults"
import { isLocalBuild } from "@/lib/local-mode"
import type { RepoConfig } from "@/lib/repo-configs.types"
import { listRoomsForUser } from "@/lib/rooms"
import { openRoom } from "@/lib/room-access"
import { createRoomCollections } from "@/lib/yjs/schema"
import { envVarsDigest, kvCanvasRepoEnvStore } from "@/lib/repo-env/store"
import { createRepositoryLibrary } from "./library"
import { kvRepositoryStore } from "./store"

async function library() {
  const userId = await requireUserId()
  return createRepositoryLibrary({
    userId,
    store: kvRepositoryStore(userId),
    rooms: {
      list: async () => (await listRoomsForUser(userId)).map((r) => r.id),
      read: async (roomId, fn) =>
        (await openRoom(roomId)).readDoc((c) =>
          fn(createRoomCollections(c.doc))
        ),
      // A fresh collections view per write: nothing observes a server doc,
      // so a cached view's snapshot could hide this write's own changes.
      mutate: async (roomId, fn) =>
        (await openRoom(roomId)).mutateDoc((c) =>
          fn(createRoomCollections(c.doc))
        ),
    },
    env: {
      set: (roomId, repoId, text) =>
        kvCanvasRepoEnvStore.set(roomId, repoId, text),
      digest: envVarsDigest,
    },
    mode: isLocalBuild ? "desktop" : "hosted",
    mint: () => ({ id: nanoid(), now: Date.now() }),
  })
}

/** Your Repositories (Settings › Repositories). */
export async function listRepositories(): Promise<RepoConfig[]> {
  const repositories = await library()
  if (await hasFixtureFault("no-presets")) return []
  return repositories.list()
}

/** Create or update one of your Repositories; returns the new list. */
export async function saveRepository(
  repository: RepoConfig
): Promise<RepoConfig[]> {
  return (await library()).save(repository)
}

/** Save a Canvas edit to one of your Repositories and every Canvas using it,
 *  clearing their customizations; returns the new list. */
export async function saveRepositoryToAll(
  repository: RepoConfig
): Promise<RepoConfig[]> {
  return (await library()).saveToAll(repository)
}

/** How many of your Canvases use one of your Repositories (the delete
 *  confirm's count). */
export async function repositoryCanvasCount(
  repositoryId: string
): Promise<number> {
  return (await library()).canvasCount(repositoryId)
}

/** Delete one of your Repositories; returns the new list. Canvases using it
 *  keep their copy, unlinked. */
export async function deleteRepository(
  repositoryId: string
): Promise<RepoConfig[]> {
  return (await library()).delete(repositoryId)
}
