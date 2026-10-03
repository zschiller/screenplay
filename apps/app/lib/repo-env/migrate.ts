import "server-only"

import type { RoomDoc } from "@/lib/room-access"
import {
  envDocFields,
  loadCanvasRepoEnv,
  type CanvasRepoEnvStore,
} from "./store"

/**
 * The one-time move for one Canvas (#1416): every Repo still carrying
 * plain-text `envVars` in the room doc gets its values encrypted into the
 * store and the doc keeps only their names and digest. Idempotent, so it runs
 * wherever a Canvas is opened for it (the Canvas on load, provisioning)
 * without a marker: a Canvas with nothing left to move costs one read. Values
 * stored since (a save that beat the move) win over the legacy copy. Returns
 * how many Repos it moved.
 */
export async function migrateCanvasRepoEnv(
  room: Pick<RoomDoc, "roomId" | "readDoc" | "mutateDoc">,
  store: CanvasRepoEnvStore
): Promise<number> {
  const legacy = await room.readDoc(({ repos }) =>
    repos
      .toArray()
      // Read fresh by id: a server-side snapshot can lag its own writes.
      .map((r) => repos.get(r.id))
      .filter((r) => r !== undefined && r.envVars !== undefined)
      .map((r) => ({ id: r!.id, envVars: r!.envVars }))
  )
  if (legacy.length === 0) return 0

  const texts = new Map<string, string>()
  for (const repo of legacy) {
    const stored = await store.get(room.roomId, repo.id)
    if (stored === null && repo.envVars) {
      await store.set(room.roomId, repo.id, repo.envVars)
    }
    texts.set(repo.id, await loadCanvasRepoEnv(store, room.roomId, repo))
  }

  return room.mutateDoc(({ repos, transact }) => {
    let moved = 0
    transact(() => {
      for (const [id, text] of texts) {
        if (repos.get(id)?.envVars === undefined) continue
        repos.update(id, envDocFields(text))
        moved++
      }
    })
    return moved
  })
}
