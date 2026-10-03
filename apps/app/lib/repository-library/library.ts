import type { RepoConfig } from "@/lib/repo-configs.types"
import type { RoomCollections } from "@/lib/yjs/schema"
import { applyRepositoryEdit, linkCanvasRepos, sameRepository } from "./canvas"

/** Where one person's Repositories live, plus whether their one-time
 *  migration has run. Production is the encrypted per-user KV (`./store`). */
export interface RepositoryStore {
  load(): Promise<RepoConfig[]>
  save(list: RepoConfig[]): Promise<void>
  isMigrated(): Promise<boolean>
  markMigrated(): Promise<void>
}

/** The person's Canvases, opened for writing one at a time. */
export interface CanvasRooms {
  /** Ids of every Canvas the person can open. */
  list(): Promise<string[]>
  mutate<T>(roomId: string, fn: (collections: RoomCollections) => T): Promise<T>
}

export interface RepositoryLibraryDeps {
  userId: string
  store: RepositoryStore
  rooms: CanvasRooms
  /** Desktop has one person, so every Canvas Repo can have a home in
   *  Settings; hosted can't tell whose a pre-library Repo was. */
  mode: "desktop" | "hosted"
  /** Mints ids and timestamps; injected so tests stay deterministic. */
  mint: () => { id: string; now: number }
}

export type RepositoryLibrary = ReturnType<typeof createRepositoryLibrary>

/** Migrations in flight, by user: a library is built per request, and two
 *  first loads racing must not each create the same desktop Repositories. */
const migrating = new Map<string, Promise<void>>()

/**
 * The repository library's store half (#1420): one person's Repositories, and
 * the one-time migration that links their Canvases to them. Settings and the
 * add flow call this instead of writing the per-user store directly; the
 * Canvas half (switch on/off) is in `./canvas`.
 */
export function createRepositoryLibrary({
  userId,
  store,
  rooms,
  mode,
  mint,
}: RepositoryLibraryDeps) {
  /**
   * The one-time migration, run on the person's first list. Presets already
   * are Repositories; this links every Canvas Repo with a matching identity
   * and, on desktop, gives each unmatched one a Repository of its own. Marked
   * done only once every Canvas succeeded, so a failure retries next time
   * (linking skips Repos that are already linked, and finds the Repositories
   * an earlier try created by identity).
   */
  async function migrate(): Promise<void> {
    if (await store.isMigrated()) return
    let repositories = await store.load()
    let failed = false
    for (const roomId of await rooms.list()) {
      let created: RepoConfig[]
      try {
        created = await rooms.mutate(roomId, (collections) =>
          linkCanvasRepos(collections, repositories, {
            userId,
            createMissing: mode === "desktop",
            mint,
          })
        )
      } catch (err) {
        // One Canvas that won't open mustn't keep the rest unlinked.
        console.error(`Couldn't link repositories on canvas ${roomId}`, err)
        failed = true
        continue
      }
      if (created.length > 0) {
        repositories = [...repositories, ...created]
        await store.save(repositories)
      }
    }
    if (!failed) await store.markMigrated()
  }

  /**
   * Settings edits reach the Canvases: every Canvas the person can open gets
   * the edit on its uncustomized Repos linked to the Repository. A Canvas
   * that won't open keeps its old copy rather than failing the save.
   */
  async function propagate(
    before: RepoConfig,
    after: RepoConfig,
    options: { overrideCustomized?: boolean } = {}
  ) {
    for (const roomId of await rooms.list()) {
      try {
        await rooms.mutate(roomId, (collections) =>
          applyRepositoryEdit(collections, before, after, options)
        )
      } catch (err) {
        console.error(`Couldn't update repositories on canvas ${roomId}`, err)
      }
    }
  }

  function ensureMigrated(): Promise<void> {
    let run = migrating.get(userId)
    if (!run) {
      run = migrate().finally(() => migrating.delete(userId))
      migrating.set(userId, run)
    }
    return run
  }

  return {
    /** The person's Repositories, migrating their Canvases first if needed. */
    async list(): Promise<RepoConfig[]> {
      await ensureMigrated()
      return store.load()
    },

    /**
     * Create or update a Repository; returns the new list. Idempotent by
     * identity: an id match (editing one) wins, else a Repository with the
     * same remote + name is updated in place, keeping its id and createdAt,
     * so re-saving one you already have never duplicates it. An update then
     * reaches every Canvas Repo linked to it that isn't customized.
     */
    async save(repository: RepoConfig): Promise<RepoConfig[]> {
      const list = await store.load()
      const target =
        list.find((r) => r.id === repository.id) ??
        list.find((r) => sameRepository(r, repository))
      const saved = target
        ? { ...repository, id: target.id, createdAt: target.createdAt }
        : repository
      const next = target
        ? list.map((r) => (r.id === target.id ? saved : r))
        : [...list, repository]
      await store.save(next)
      if (target) await propagate(target, saved)
      return next
    },

    /**
     * Save to all (#1425): an edit made on a Canvas, saved to the Repository
     * and to every Canvas Repo linked to it, customized or not, so none stays
     * customized. Only for one of your Repositories, by id; returns the new
     * list.
     */
    async saveToAll(repository: RepoConfig): Promise<RepoConfig[]> {
      const list = await store.load()
      const target = list.find((r) => r.id === repository.id)
      if (!target) throw new Error("That repository isn't in your Settings")
      const saved = { ...repository, createdAt: target.createdAt }
      const next = list.map((r) => (r.id === target.id ? saved : r))
      await store.save(next)
      await propagate(target, saved, { overrideCustomized: true })
      return next
    },

    /** Delete a Repository; returns the new list. */
    async delete(repositoryId: string): Promise<RepoConfig[]> {
      const next = (await store.load()).filter((r) => r.id !== repositoryId)
      await store.save(next)
      return next
    },

    migrate: ensureMigrated,
  }
}
