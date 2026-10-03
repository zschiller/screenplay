import type { RoomDoc } from "@/lib/room-access"
import type { RoomRole } from "@/lib/yjs-host/types"
import type { RepoData } from "@/lib/types"
import { canRevealEnv, envVarNames, mergeEnvVars } from "./names"
import {
  envDocFields,
  loadCanvasRepoEnv,
  type CanvasRepoEnvStore,
} from "./store"

/**
 * **Canvas Repo env** (#1492): the one place a Canvas Repo's env var values
 * change. Values go to the encrypted store (`./store`); the room doc records
 * only their names and digest (`envDocFields`). Every operation stores the
 * values first and writes the doc only once the store succeeded, so the doc
 * never lists names whose values weren't stored (#1476): a failure rejects
 * and leaves the doc as it was.
 *
 * Who may do what follows #1416: whoever {@link canRevealEnv} allows (the
 * Repo's adder; the owner when nobody recorded one; anyone on desktop)
 * reveals the values and saves the whole set; any other editor's lines go
 * over the stored values (#1475); viewers change nothing.
 */

/** What the room doc records about a Repo's values. */
export type EnvDocFields = Pick<RepoData, "envVarNames" | "envVarsDigest">

/** The person a Canvas Repo env is opened for. */
export interface EnvViewer {
  userId: string
  role: RoomRole
  /** The desktop build, where the one person there sees every value. */
  localBuild: boolean
}

/** The Canvas, as much of a room as this module needs. */
export type EnvRoom = Pick<RoomDoc, "roomId" | "readDoc" | "mutateDoc">

/** Whether `viewer` may reveal `repo`'s values and save them whole. */
export function viewerCanRevealEnv(
  repo: Pick<RepoData, "addedBy">,
  viewer: EnvViewer
): boolean {
  return canRevealEnv(repo, {
    userId: viewer.userId,
    isOwner: viewer.role === "owner",
    localBuild: viewer.localBuild,
  })
}

/**
 * Store `text` as a Canvas Repo's values, then record their names and digest
 * on the Repo when the doc has it. No permission check: for callers that
 * already decided (the operations below, Settings edits reaching a Canvas).
 */
export async function writeCanvasRepoEnv(
  room: EnvRoom,
  store: CanvasRepoEnvStore,
  repoId: string,
  text: string
): Promise<EnvDocFields> {
  await store.set(room.roomId, repoId, text)
  await room.mutateDoc(({ repos }) => {
    if (repos.get(repoId)) repos.update(repoId, envDocFields(text))
  })
  return docFields(text)
}

function docFields(text: string): EnvDocFields {
  const { envVarNames, envVarsDigest } = envDocFields(text)
  return { envVarNames, envVarsDigest }
}

/** A Canvas Repo env opened for one person. */
export function canvasRepoEnv(
  room: EnvRoom,
  store: CanvasRepoEnvStore,
  viewer: EnvViewer
) {
  // Read fresh by id: a server-side snapshot can lag its own writes.
  const readRepo = (repoId: string) =>
    room.readDoc(({ repos }) => repos.get(repoId))

  async function editableRepo(repoId: string): Promise<RepoData> {
    if (viewer.role === "viewer") {
      throw new Error("Viewers can't change settings")
    }
    const repo = await readRepo(repoId)
    if (!repo) throw new Error("Repository not found")
    return repo
  }

  return {
    /**
     * Save from the Repo settings form. Whoever may reveal the values saves
     * `text` as the whole set; anyone else's lines replace just the
     * variables they name, so values they can't see survive (#1475).
     */
    async save(repoId: string, text: string): Promise<EnvDocFields> {
      const repo = await editableRepo(repoId)
      const next = viewerCanRevealEnv(repo, viewer)
        ? text
        : mergeEnvVars(await loadCanvasRepoEnv(store, room.roomId, repo), text)
      return writeCanvasRepoEnv(room, store, repoId, next)
    },

    /** Reset to Settings: the Repository's values replace the Canvas's.
     *  Only for whoever may reveal them, since it wipes the stored set. */
    async reset(repoId: string, text: string): Promise<EnvDocFields> {
      const repo = await editableRepo(repoId)
      if (!viewerCanRevealEnv(repo, viewer)) {
        throw new Error(
          "Only the person who added this repository can replace its values"
        )
      }
      return writeCanvasRepoEnv(room, store, repoId, text)
    },

    /**
     * Switching a Repository on: store its values under the new Repo's id
     * before the Repo exists, and hand back the fields its record starts
     * with. Only for an id nothing is stored under yet, so it can't
     * overwrite an existing Repo's values.
     */
    async copyIn(repoId: string, text: string): Promise<EnvDocFields> {
      if (viewer.role === "viewer") {
        throw new Error("Viewers can't change settings")
      }
      if ((await readRepo(repoId)) || (await store.get(room.roomId, repoId))) {
        throw new Error("That repository is already on this canvas")
      }
      await store.set(room.roomId, repoId, text)
      return docFields(text)
    },

    /** The stored values, for the adder's edit form; anyone else gets an
     *  error and keeps seeing names only. */
    async reveal(repoId: string): Promise<string> {
      const repo = await readRepo(repoId)
      if (!repo) throw new Error("Repository not found")
      if (!viewerCanRevealEnv(repo, viewer)) {
        throw new Error(
          "Only the person who added this repository can see its values"
        )
      }
      return loadCanvasRepoEnv(store, room.roomId, repo)
    },
  }
}

/** A {@link CanvasRepoEnvStore} in memory, for tests: what it holds is
 *  `rows`, keyed `roomId:repoId`. */
export function memoryCanvasRepoEnvStore(): CanvasRepoEnvStore & {
  rows: Map<string, string>
} {
  const rows = new Map<string, string>()
  return {
    rows,
    async get(roomId, repoId) {
      return rows.get(`${roomId}:${repoId}`) ?? null
    },
    async set(roomId, repoId, text) {
      if (envVarNames(text).length === 0) rows.delete(`${roomId}:${repoId}`)
      else rows.set(`${roomId}:${repoId}`, text)
    },
  }
}
