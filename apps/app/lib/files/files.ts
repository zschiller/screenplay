import { nanoid } from "nanoid"

import type { FileEntryData } from "@/lib/types"
import type { FileStore } from "./store"
import {
  ancestorPaths,
  freePath,
  isWithin,
  mediaTypeFor,
  normalizeFilePath,
} from "./paths"

/**
 * The **files module** (#1514): one set of verbs (list, read, save, move,
 * delete, make folder) over a scope's file entries and the bytes behind them.
 * Agent tools go through it today; the Files sections and chat attachments
 * will too, so none of them can disagree on what a folder or a move means.
 *
 * A scope is an index of entries (Canvas Files keep theirs in the Room's
 * Y.Doc, `canvas-files.ts`) plus the private {@link FileStore} its bytes live
 * in, under keys that start with the scope's `keyPrefix`. A file's key comes
 * from its id, so moving or renaming one never touches its bytes.
 */

/** The largest file kept, in bytes (the spec's attachment cap). */
export const FILE_MAX_BYTES = 25 * 1024 * 1024

/** A transaction over a scope's entries: reads see its own writes. */
export interface FileIndexTx {
  all(): FileEntryData[]
  set(entry: FileEntryData): void
  delete(id: string): void
}

/** Where a scope keeps its entries. */
export interface FileIndex {
  entries(): Promise<FileEntryData[]>
  mutate<T>(fn: (tx: FileIndexTx) => T): Promise<T>
}

/** Who a write is for: an agent chat, or a member. */
export interface FileAuthor {
  addedBy: FileEntryData["addedBy"]
  addedById: string
}

export type FileResult<T> =
  { ok: true; value: T } | { ok: false; error: string }

export interface Files {
  /** Every entry, by path; under `folder` (and the folder itself excluded) when given. */
  list(folder?: string): Promise<FileResult<FileEntryData[]>>
  /** A file's entry and bytes. */
  read(
    path: string
  ): Promise<FileResult<{ entry: FileEntryData; bytes: Uint8Array }>>
  /**
   * Save `bytes` at `path`, replacing a file already there and making any
   * folder above it. `mediaType` defaults to one from the extension.
   */
  save(input: {
    path: string
    bytes: Uint8Array
    mediaType?: string
    fallbackMediaType: string
    author: FileAuthor
    now?: number
    /**
     * Keep a file already at `path` and save beside it with a suffix
     * (`photo-2.png`) instead of replacing it. The entry says where it went.
     */
    keepExisting?: boolean
  }): Promise<FileResult<{ entry: FileEntryData; replaced: boolean }>>
  /**
   * Add an entry for bytes already in the store under `blobKey` (a browser
   * upload straight to the store, #1525), as {@link Files.save} would place
   * them. The key must be one of this scope's.
   */
  adopt(input: {
    path: string
    blobKey: string
    size: number
    mediaType: string
    author: FileAuthor
    now?: number
    keepExisting?: boolean
  }): Promise<FileResult<{ entry: FileEntryData; replaced: boolean }>>
  /** Move (or rename) a file or a folder with everything in it. */
  move(
    from: string,
    to: string,
    now?: number
  ): Promise<FileResult<{ kind: FileEntryData["kind"]; moved: number }>>
  /** Delete a file, or a folder with everything in it. */
  remove(
    path: string
  ): Promise<FileResult<{ kind: FileEntryData["kind"]; removed: number }>>
  /** Make a folder (and any above it). Making one that exists is fine. */
  makeFolder(
    path: string,
    author: FileAuthor,
    now?: number
  ): Promise<FileResult<{ created: boolean }>>
}

const ok = <T>(value: T): FileResult<T> => ({ ok: true, value })
const fail = <T>(error: string): FileResult<T> => ({ ok: false, error })

/** Sorted by path, so a listing reads as a tree. */
const byPath = (a: FileEntryData, b: FileEntryData) =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0

export function createFiles(scope: {
  index: FileIndex
  store: FileStore
  keyPrefix: string
}): Files {
  const { index, store, keyPrefix } = scope

  /** Make each missing folder above `path`; an error names a file in the way. */
  const ensureFolders = (
    tx: FileIndexTx,
    path: string,
    author: FileAuthor,
    now: number
  ): string | null => {
    for (const folder of ancestorPaths(path)) {
      const existing = tx.all().find((e) => e.path === folder)
      if (existing?.kind === "file") {
        return `"${folder}" is a file, so nothing can go inside it.`
      }
      if (!existing) tx.set(folderEntry(folder, author, now))
    }
    return null
  }

  const isScopeKey = (key: string) =>
    key.startsWith(`${keyPrefix}/`) &&
    /^[A-Za-z0-9_-]+$/.test(key.slice(keyPrefix.length + 1))

  /**
   * Point an entry at bytes already stored: the path's file keeps its id
   * (its bytes were just replaced), or, with `keepExisting`, the entry goes
   * to the first free path beside it.
   */
  const place = async (input: {
    path: string
    id: string
    blobKey: string
    size: number
    mediaType: string
    author: FileAuthor
    at: number
    keepExisting?: boolean
  }): Promise<FileResult<{ entry: FileEntryData; replaced: boolean }>> => {
    const { id, blobKey, size, mediaType, author, at, keepExisting } = input
    const outcome = await index.mutate<
      | { error: string }
      | { entry: FileEntryData; orphan: string | null; replaced: boolean }
    >((tx) => {
      const all = tx.all()
      const path = keepExisting
        ? freePath(input.path, (q) => all.some((e) => e.path === q))
        : input.path
      const existing = all.find((e) => e.path === path)
      if (existing?.kind === "folder")
        return { error: `"${path}" is a folder.` }
      const blocked = ensureFolders(tx, path, author, at)
      if (blocked) return { error: blocked }
      const entry: FileEntryData = {
        id: existing?.id ?? id,
        path,
        kind: "file",
        size,
        mediaType,
        addedBy: author.addedBy,
        addedById: author.addedById,
        blobKey,
        createdAt: existing?.createdAt ?? at,
        updatedAt: at,
      }
      // Another save took the path between our read and this write: ours
      // wins, and its bytes go.
      const orphan =
        existing && existing.blobKey !== blobKey ? existing.blobKey : null
      if (existing && existing.id !== entry.id) tx.delete(existing.id)
      tx.set(entry)
      return { entry, orphan, replaced: !!existing }
    })
    if ("error" in outcome) return fail(outcome.error)
    const { entry, orphan, replaced } = outcome
    if (orphan) await store.delete([orphan]).catch(() => {})
    return ok({ entry, replaced })
  }

  return {
    async list(folder) {
      const entries = (await index.entries()).sort(byPath)
      if (folder === undefined) return ok(entries)
      const p = normalizeFilePath(folder)
      if ("error" in p) return fail(p.error)
      const root = entries.find((e) => e.path === p.path)
      if (!root) return fail(`No folder at "${p.path}".`)
      if (root.kind !== "folder") return fail(`"${p.path}" is a file.`)
      return ok(
        entries.filter((e) => e.path !== p.path && isWithin(e.path, p.path))
      )
    },

    async read(raw) {
      const p = normalizeFilePath(raw)
      if ("error" in p) return fail(p.error)
      const entry = (await index.entries()).find((e) => e.path === p.path)
      if (!entry) return fail(`No file at "${p.path}".`)
      if (entry.kind === "folder") return fail(`"${p.path}" is a folder.`)
      const bytes = await store.get(entry.blobKey)
      if (!bytes) return fail(`"${p.path}" has no contents stored.`)
      return ok({ entry, bytes })
    },

    async save({
      path: raw,
      bytes,
      mediaType,
      fallbackMediaType,
      author,
      now,
      keepExisting,
    }) {
      const p = normalizeFilePath(raw)
      if ("error" in p) return fail(p.error)
      if (bytes.byteLength > FILE_MAX_BYTES) {
        return fail(
          `The file is ${bytes.byteLength} bytes; the most a file can be is ${FILE_MAX_BYTES} (25 MB).`
        )
      }
      const type = mediaType?.trim() || mediaTypeFor(p.path, fallbackMediaType)
      const before = keepExisting
        ? undefined
        : (await index.entries()).find((e) => e.path === p.path)
      if (before?.kind === "folder") return fail(`"${p.path}" is a folder.`)

      // Bytes first, so an entry never points at nothing. A file already at
      // the path keeps its id and key; its bytes are simply replaced.
      const id = before?.id ?? newFileId()
      const blobKey = before?.blobKey || `${keyPrefix}/${id}`
      await store.put(blobKey, bytes, type)

      const outcome = await place({
        path: p.path,
        id,
        blobKey,
        size: bytes.byteLength,
        mediaType: type,
        author,
        at: now ?? Date.now(),
        keepExisting,
      })
      if (!outcome.ok && !before) await store.delete([blobKey]).catch(() => {})
      return outcome
    },

    async adopt({
      path: raw,
      blobKey,
      size,
      mediaType,
      author,
      now,
      keepExisting,
    }) {
      const p = normalizeFilePath(raw)
      if ("error" in p) return fail(p.error)
      if (!isScopeKey(blobKey)) return fail("That upload isn’t this scope’s.")
      if (size > FILE_MAX_BYTES) {
        return fail(
          `The file is ${size} bytes; the most a file can be is ${FILE_MAX_BYTES} (25 MB).`
        )
      }
      return place({
        path: p.path,
        id: blobKey.slice(keyPrefix.length + 1),
        blobKey,
        size,
        mediaType:
          mediaType.trim() || mediaTypeFor(p.path, "application/octet-stream"),
        author,
        at: now ?? Date.now(),
        keepExisting,
      })
    },

    async move(rawFrom, rawTo, now) {
      const from = normalizeFilePath(rawFrom)
      if ("error" in from) return fail(from.error)
      const to = normalizeFilePath(rawTo)
      if ("error" in to) return fail(to.error)
      if (from.path === to.path) return fail("It’s already there.")
      const at = now ?? Date.now()
      return index.mutate((tx) => {
        const entries = tx.all()
        const source = entries.find((e) => e.path === from.path)
        if (!source) return fail(`Nothing at "${from.path}".`)
        if (entries.some((e) => e.path === to.path)) {
          return fail(`"${to.path}" already exists.`)
        }
        if (source.kind === "folder" && isWithin(to.path, from.path)) {
          return fail("A folder can’t move inside itself.")
        }
        const blocked = ensureFolders(
          tx,
          to.path,
          { addedBy: source.addedBy, addedById: source.addedById },
          at
        )
        if (blocked) return fail(blocked)
        const moving = entries.filter((e) => isWithin(e.path, from.path))
        for (const e of moving) {
          tx.set({
            ...e,
            path: to.path + e.path.slice(from.path.length),
            updatedAt: at,
          })
        }
        return ok({ kind: source.kind, moved: moving.length })
      })
    },

    async remove(raw) {
      const p = normalizeFilePath(raw)
      if ("error" in p) return fail(p.error)
      const outcome = await index.mutate<
        | { error: string }
        | { kind: FileEntryData["kind"]; removing: FileEntryData[] }
      >((tx) => {
        const entries = tx.all()
        const target = entries.find((e) => e.path === p.path)
        if (!target) return { error: `Nothing at "${p.path}".` }
        const removing = entries.filter((e) => isWithin(e.path, p.path))
        for (const e of removing) tx.delete(e.id)
        return { kind: target.kind, removing }
      })
      if ("error" in outcome) return fail(outcome.error)
      const { kind, removing } = outcome
      const keys = removing.map((e) => e.blobKey).filter(Boolean)
      // The entries are gone either way; a store hiccup only leaves bytes
      // nothing points at.
      if (keys.length) await store.delete(keys).catch(() => {})
      return ok({ kind, removed: removing.length })
    },

    async makeFolder(raw, author, now) {
      const p = normalizeFilePath(raw)
      if ("error" in p) return fail(p.error)
      const at = now ?? Date.now()
      return index.mutate((tx) => {
        const existing = tx.all().find((e) => e.path === p.path)
        if (existing?.kind === "file") return fail(`"${p.path}" is a file.`)
        if (existing) return ok({ created: false })
        const blocked = ensureFolders(tx, p.path, author, at)
        if (blocked) return fail(blocked)
        tx.set(folderEntry(p.path, author, at))
        return ok({ created: true })
      })
    },
  }
}

function newFileId(): string {
  return `file-${nanoid(10)}`
}

function folderEntry(
  path: string,
  author: FileAuthor,
  now: number
): FileEntryData {
  return {
    id: newFileId(),
    path,
    kind: "folder",
    size: 0,
    mediaType: "",
    addedBy: author.addedBy,
    addedById: author.addedById,
    blobKey: "",
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * An in-memory {@link FileIndex}, for tests and as the shape a key-value
 * backed index (Account Files) follows.
 */
export function memoryFileIndex(initial: FileEntryData[] = []): FileIndex {
  let entries = [...initial]
  return {
    async entries() {
      return entries.map((e) => ({ ...e }))
    },
    async mutate(fn) {
      const draft = new Map(entries.map((e) => [e.id, { ...e }]))
      const result = fn({
        all: () => [...draft.values()],
        set: (e) => void draft.set(e.id, { ...e }),
        delete: (id) => void draft.delete(id),
      })
      entries = [...draft.values()]
      return result
    },
  }
}
