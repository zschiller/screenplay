import type { RepoConfig } from "@/lib/repo-configs.types"
import type { RoomCollections } from "@/lib/yjs/schema"
import {
  applyRepositoryEdit,
  linkCanvasRepos,
  linkedRepo,
  sameRepository,
  unlinkRepository,
} from "./canvas"

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
  read<T>(roomId: string, fn: (collections: RoomCollections) => T): Promise<T>
  mutate<T>(roomId: string, fn: (collections: RoomCollections) => T): Promise<T>
}

/** Canvas Repos' env var values, encrypted per Canvas + Repo (#1416). */
export interface CanvasEnv {
  set(roomId: string, repoId: string, text: string): Promise<void>
  /** The keyed digest a Repository's values are stamped with. */
  digest(text: string): string | undefined
}

export interface RepositoryLibraryDeps {
  userId: string
  store: RepositoryStore
  rooms: CanvasRooms
  env: CanvasEnv
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
  env,
  mode,
  mint,
}: RepositoryLibraryDeps) {
  /** Repositories as callers get them: stamped with their values' digest,
   *  so a Canvas can compare without seeing values (#1416). */
  const stamped = (list: RepoConfig[]): RepoConfig[] =>
    list.map((r) => ({ ...r, envVarsDigest: env.digest(r.envVars) }))

  /** As stored: the digest is derived, never kept. */
  const unstamped = (repository: RepoConfig): RepoConfig => {
    const { envVarsDigest: _, ...rest } = repository
    return rest
  }

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
   * the edit on its uncustomized Repos linked to the Repository, and their
   * stored env var values become the Repository's. A Canvas that won't open
   * keeps its old copy rather than failing the save.
   */
  async function propagate(before: RepoConfig, after: RepoConfig) {
    const [b, a] = stamped([before, after])
    for (const roomId of await rooms.list()) {
      try {
        const updated = await rooms.mutate(roomId, (collections) =>
          applyRepositoryEdit(collections, b!, a!)
        )
        for (const repoId of updated) await env.set(roomId, repoId, a!.envVars)
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
      return stamped(await store.load())
    },

    /**
     * Create or update a Repository; returns the new list. Idempotent by
     * identity: an id match (editing one) wins, else a Repository with the
     * same remote + name is updated in place, keeping its id and createdAt,
     * so re-saving one you already have never duplicates it. An update then
     * reaches every Canvas Repo linked to it that isn't customized.
     */
    async save(input: RepoConfig): Promise<RepoConfig[]> {
      const repository = unstamped(input)
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
      return stamped(next)
    },

    /**
     * How many Canvases have a Repo linked to the Repository, for the delete
     * confirm. A Canvas that won't open isn't counted.
     */
    async canvasCount(repositoryId: string): Promise<number> {
      let count = 0
      for (const roomId of await rooms.list()) {
        try {
          const uses = await rooms.read(roomId, (collections) =>
            Boolean(linkedRepo(collections, repositoryId))
          )
          if (uses) count++
        } catch (err) {
          console.error(`Couldn't read repositories on canvas ${roomId}`, err)
        }
      }
      return count
    },

    /**
     * Delete a Repository; returns the new list. Every Canvas Repo linked to
     * it stays, unlinked: the Canvas keeps its copy, which stops getting
     * Settings edits. A Canvas that won't open keeps its link to nothing,
     * which reads as unlinked too.
     */
    async delete(repositoryId: string): Promise<RepoConfig[]> {
      const next = (await store.load()).filter((r) => r.id !== repositoryId)
      await store.save(next)
      for (const roomId of await rooms.list()) {
        try {
          await rooms.mutate(roomId, (collections) =>
            unlinkRepository(collections, repositoryId)
          )
        } catch (err) {
          console.error(`Couldn't unlink repositories on canvas ${roomId}`, err)
        }
      }
      return stamped(next)
    },

    migrate: ensureMigrated,
  }
}
