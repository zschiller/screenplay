import "server-only"

import { nanoid } from "nanoid"
import { requireUserId } from "@/lib/auth-helpers"
import { listRoomsForUser } from "@/lib/rooms"
import { openRoom } from "@/lib/room-access"
import { createRoomCollections } from "@/lib/yjs/schema"
import { writeCanvasRepoEnv } from "@/lib/repo-env/canvas-repo-env"
import { envVarsDigest, kvCanvasRepoEnvStore } from "@/lib/repo-env/store"
import { createRepositoryLibrary } from "./library"
import { repositoryLinkPolicy } from "./link-policy"
import { kvRepositoryStore } from "./store"

/** The signed-in person's repository library, on the server's stores. */
export async function library() {
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
      write: async (roomId, repoId, text) =>
        writeCanvasRepoEnv(
          await openRoom(roomId),
          kvCanvasRepoEnvStore,
          repoId,
          text
        ),
      digest: envVarsDigest,
    },
    policy: repositoryLinkPolicy,
    mint: () => ({ id: nanoid(), now: Date.now() }),
  })
}
