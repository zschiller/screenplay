import type { FileEntryData } from "@/lib/types"
import { createFiles, type FileIndex, type Files } from "./files"
import { accountFileKeyPrefix } from "./paths"
import type { FileStore } from "./store"

/**
 * **Account Files** (#1521): one person's files, which follow them to every
 * canvas. Every chat they send a turn in lists and opens them; nobody else
 * ever sees them, and a turn nobody sent (a Coordinator wake) gets none.
 * Their entries live in a per-person store (the encrypted KV, beside account
 * memory: `./account-store`); their bytes live in the private file store under
 * `account/<userId>/`.
 */

/** Where one person's Account Files entries live, as one list. */
export interface FileListStore {
  load(): Promise<FileEntryData[]>
  save(entries: FileEntryData[]): Promise<void>
  /**
   * Run `fn` with nobody else writing the list, so two saves at once can't
   * drop each other's entry.
   */
  exclusive?<T>(fn: () => Promise<T>): Promise<T>
}

/**
 * A files module index over a {@link FileListStore}: each write loads the
 * list, applies the transaction and saves it, holding the store's
 * `exclusive` when it has one.
 */
export function listFileIndex(store: FileListStore): FileIndex {
  const exclusive = <T>(fn: () => Promise<T>) =>
    store.exclusive ? store.exclusive(fn) : fn()
  return {
    entries: () => store.load(),
    mutate: (fn) =>
      exclusive(async () => {
        const draft = new Map((await store.load()).map((e) => [e.id, { ...e }]))
        const result = fn({
          all: () => [...draft.values()],
          set: (e) => void draft.set(e.id, { ...e }),
          delete: (id) => void draft.delete(id),
        })
        await store.save([...draft.values()])
        return result
      }),
  }
}

/** One person's Account Files over `index` and `store`. */
export function accountFilesOn(
  userId: string,
  index: FileIndex,
  store: FileStore
): Files {
  return createFiles({
    index,
    store,
    keyPrefix: accountFileKeyPrefix(userId),
  })
}

/** A list held in memory, for tests and fixtures. */
export function memoryFileListStore(
  initial: FileEntryData[] = []
): FileListStore {
  let list = initial.map((e) => ({ ...e }))
  return {
    load: async () => list.map((e) => ({ ...e })),
    save: async (next) => {
      list = next.map((e) => ({ ...e }))
    },
  }
}
