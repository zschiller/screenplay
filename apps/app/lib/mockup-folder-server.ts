import "server-only"

import { createHmac, timingSafeEqual } from "node:crypto"

import { mediaTypeFor, normalizeFilePath } from "@/lib/files/paths"
import type { FileStore } from "@/lib/files/store"
import {
  MOCKUP_FOLDER_MAX_BYTES,
  MOCKUP_INDEX,
  MOCKUP_PAGE_TOKEN_TTL_MS,
  isMockupFileId,
  mockupFolderPrefix,
  mockupPagesPath,
  type MockupPageResponse,
} from "@/lib/mockup-folder"
import type { RoomDoc, RoomReader } from "@/lib/room-access"
import type { LayerFileData } from "@/lib/types"
import { mockupHtml, writeMockupHtml } from "@/lib/yjs/mockup-html"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { layerFileOf, updateLayerFile } from "@/lib/yjs/file-views"

/**
 * The server side of **Mockup Folders** (`lib/mockup-folder.ts`, #1886): the
 * folder's bytes in the private file store, its revision in the room doc, and
 * the tokens the pages route takes.
 *
 * A Mockup's file keeps its folder under `canvas/<roomId>/mockups/<fileId>/`.
 * Two kinds of Mockup have no folder yet, and get one the first time anything
 * with write access reads them ({@link MockupFolder.ensure}): one from before
 * folders, whose page is still the room doc's `mockup-layer-{fileId}` text
 * (moved into `index.html`, and the text emptied), and a Duplicate a member's
 * canvas made, which can't write the store (`copyOf`, the source's folder
 * copied).
 */

/** One file in a Mockup's folder. */
export type MockupFolderFile = { path: string; size: number }

/** A file to write into a Mockup's folder. */
export type MockupFolderWrite = { path: string; bytes: Uint8Array }

export type MockupFolderResult<T> =
  { ok: true; value: T } | { ok: false; error: string }

export interface MockupFolder {
  /**
   * The Mockup's page: `index.html` and the folder's revision, giving a
   * Mockup from before folders (or a copy not made yet) its folder first
   * when the room can be written. `null` when no Mockup has that id;
   * `html` is "" for one with no page yet.
   */
  page(
    id: string
  ): Promise<{ fileId: string; html: string; revision: number } | null>
  /** Give the Mockup its folder if it has none yet; its revision after. */
  ensure(fileId: string): Promise<number>
  /** Every file in the folder, by path. */
  list(fileId: string): Promise<MockupFolderFile[]>
  /** One file's bytes, or `null` when the folder has none at `path`. */
  read(fileId: string, path: string): Promise<Uint8Array | null>
  /**
   * Write files into the folder (replacing any at the same paths) and remove
   * `remove`'s paths, then bump the revision so every view reloads. Refused,
   * with nothing written, when the folder would pass
   * {@link MOCKUP_FOLDER_MAX_BYTES}.
   */
  write(
    fileId: string,
    change: { files?: MockupFolderWrite[]; remove?: string[] }
  ): Promise<MockupFolderResult<{ revision: number }>>
  /**
   * Remove the folder for good, once no Mockup file in the room is
   * `fileId`: what a canvas asks for when a Mockup it deleted can no longer
   * be undone. Returns whether it did.
   */
  purge(fileId: string): Promise<boolean>
}

/** The Mockup file a record is, read fresh off the doc (nothing observes it). */
function mockupFileIn(
  c: RoomCollections,
  id: string
): LayerFileData | undefined {
  const file = layerFileOf(c, id)
  return file?.kind === "mockup" ? file : undefined
}

const fresh =
  <T>(fn: (c: RoomCollections) => T) =>
  (c: RoomCollections): T =>
    fn(createRoomCollections(c.doc))

export function mockupFolderOn(
  room: RoomDoc | RoomReader,
  store: FileStore
): MockupFolder {
  const prefixOf = (fileId: string) => mockupFolderPrefix(room.roomId, fileId)
  const keyOf = (fileId: string, path: string) => prefixOf(fileId) + path
  const put = (fileId: string, path: string, bytes: Uint8Array) =>
    store.put(
      keyOf(fileId, path),
      bytes,
      mediaTypeFor(path, "application/octet-stream")
    )
  const writable = "mutateDoc" in room ? room : null

  async function list(fileId: string): Promise<MockupFolderFile[]> {
    const prefix = prefixOf(fileId)
    return (await store.list(prefix)).map(({ key, size }) => ({
      path: key.slice(prefix.length),
      size,
    }))
  }

  /** Set the revision, unless the file changed under us; the revision after. */
  async function settle(
    fileId: string,
    next: (file: LayerFileData) => Partial<LayerFileData> | null
  ): Promise<number> {
    if (!writable) return 0
    return writable.mutateDoc(
      fresh((c) => {
        const file = mockupFileIn(c, fileId)
        if (!file) return 0
        const patch = next(file)
        if (!patch) return file.revision ?? 0
        updateLayerFile(c, fileId, patch)
        if (file.revision === undefined) {
          // A page from before folders goes out of the room doc with it.
          const text = mockupHtml(c.doc, fileId)
          if (text.length > 0) writeMockupHtml(text, "")
        }
        return patch.revision ?? file.revision ?? 0
      })
    )
  }

  async function ensure(fileId: string, depth = 0): Promise<number> {
    const state = await room.readDoc(
      fresh((c) => {
        const file = mockupFileIn(c, fileId)
        if (!file) return null
        return {
          revision: file.revision,
          copyOf: file.copyOf,
          legacy: mockupHtml(c.doc, fileId).toString(),
        }
      })
    )
    if (!state || state.revision !== undefined || !writable) {
      return state?.revision ?? 0
    }
    if (state.copyOf && depth < 4) {
      const from = state.copyOf
      await ensure(from, depth + 1)
      const files = await list(from)
      await Promise.all(
        files.map(async ({ path }) => {
          const bytes = await store.get(keyOf(from, path))
          if (bytes) await put(fileId, path, bytes)
        })
      )
      return settle(fileId, (file) =>
        file.revision === undefined
          ? { revision: files.length ? 1 : 0, copyOf: undefined }
          : null
      )
    }
    if (!state.legacy.trim()) return 0
    await put(fileId, MOCKUP_INDEX, new TextEncoder().encode(state.legacy))
    return settle(fileId, (file) =>
      file.revision === undefined ? { revision: 1 } : null
    )
  }

  async function page(
    id: string,
    depth = 0
  ): Promise<{ fileId: string; html: string; revision: number } | null> {
    const found = await room.readDoc(
      fresh((c) => {
        const file = mockupFileIn(c, id)
        return file
          ? {
              fileId: file.id,
              revision: file.revision,
              copyOf: file.copyOf,
              legacy: mockupHtml(c.doc, file.id).toString(),
            }
          : null
      })
    )
    if (!found) return null
    const { fileId } = found
    if (found.revision === undefined && !writable) {
      // A reader can't move the page; it reads it where it is.
      if (found.copyOf && depth < 4) {
        const source = await page(found.copyOf, depth + 1)
        return { fileId, html: source?.html ?? "", revision: 0 }
      }
      return { fileId, html: found.legacy, revision: 0 }
    }
    const revision = await ensure(fileId)
    if (revision === 0) return { fileId, html: "", revision }
    const bytes = await store.get(keyOf(fileId, MOCKUP_INDEX))
    return {
      fileId,
      html: bytes ? new TextDecoder().decode(bytes) : "",
      revision,
    }
  }

  return {
    page: (id) => page(id),

    ensure: (fileId) => ensure(fileId),

    list,

    async read(fileId, raw) {
      const p = normalizeFilePath(raw)
      if ("error" in p) return null
      return store.get(keyOf(fileId, p.path))
    },

    async write(fileId, { files = [], remove = [] }) {
      if (!writable) return { ok: false, error: "This room can’t be written." }
      const paths: string[] = []
      for (const raw of [...files.map((f) => f.path), ...remove]) {
        const p = normalizeFilePath(raw)
        if ("error" in p) return { ok: false, error: p.error }
        paths.push(p.path)
      }
      const writes = files.map((f, i) => ({ ...f, path: paths[i]! }))
      const removing = new Set(paths.slice(files.length))
      await ensure(fileId)
      const sizes = new Map(
        (await list(fileId)).map((f) => [f.path, f.size] as const)
      )
      for (const path of removing) sizes.delete(path)
      for (const f of writes) sizes.set(f.path, f.bytes.byteLength)
      const total = [...sizes.values()].reduce((a, b) => a + b, 0)
      if (total > MOCKUP_FOLDER_MAX_BYTES) {
        return {
          ok: false,
          error: `The Mockup’s folder would hold ${total} bytes; the most it can hold is ${MOCKUP_FOLDER_MAX_BYTES} (25 MB).`,
        }
      }
      await Promise.all(writes.map((f) => put(fileId, f.path, f.bytes)))
      if (removing.size) {
        await store.delete([...removing].map((path) => keyOf(fileId, path)))
      }
      const revision = await settle(fileId, (file) => ({
        revision: (file.revision ?? 0) + 1,
        ...(file.copyOf ? { copyOf: undefined } : {}),
      }))
      return { ok: true, value: { revision } }
    },

    async purge(fileId) {
      if (!isMockupFileId(fileId)) return false
      const exists = await room.readDoc(
        fresh((c) => layerFileOf(c, fileId) !== undefined)
      )
      if (exists) return false
      const keys = (await store.list(prefixOf(fileId))).map((f) => f.key)
      if (keys.length) await store.delete(keys)
      return true
    },
  }
}

// --- The pages route's tokens ---------------------------------------------

type PageClaims = { r: string; f: string; exp: number }

function tokenKey(): string {
  const secret = process.env.TERMINAL_AUTH_SECRET
  if (!secret) throw new Error("TERMINAL_AUTH_SECRET is not set")
  return createHmac("sha256", secret).update("mockup-pages").digest("base64url")
}

function sign(body: string): string {
  return createHmac("sha256", tokenKey()).update(body).digest("base64url")
}

/**
 * A token for one Mockup's folder in one canvas, for the pages route. Mint
 * one only for a member of the canvas (or for the server's own capture),
 * since anyone holding it may read that folder until it expires.
 */
export function mockupPageToken(
  roomId: string,
  fileId: string,
  now = Date.now()
): { token: string; expiresAt: number } {
  const exp = now + MOCKUP_PAGE_TOKEN_TTL_MS
  const body = Buffer.from(
    JSON.stringify({ r: roomId, f: fileId, exp } satisfies PageClaims)
  ).toString("base64url")
  return { token: `${body}.${sign(body)}`, expiresAt: exp }
}

/** The canvas and Mockup a token is for, or `null` for a bad or old one. */
export function verifyMockupPageToken(
  token: string,
  now = Date.now()
): { roomId: string; fileId: string } | null {
  const [body, sig, extra] = token.split(".")
  if (!body || !sig || extra !== undefined) return null
  const want = Buffer.from(sign(body))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const claims = JSON.parse(
      Buffer.from(body, "base64url").toString()
    ) as PageClaims
    if (typeof claims.r !== "string" || typeof claims.f !== "string") {
      return null
    }
    if (typeof claims.exp !== "number" || claims.exp < now) return null
    return { roomId: claims.r, fileId: claims.f }
  } catch {
    return null
  }
}

/** A page's `<base>`: the pages route for its folder at `revision`. */
export function mockupPageBase(
  roomId: string,
  fileId: string,
  revision: number,
  now = Date.now()
): { path: string; expiresAt: number } {
  const { token, expiresAt } = mockupPageToken(roomId, fileId, now)
  return { path: mockupPagesPath(token, revision), expiresAt }
}

/**
 * A Mockup's page for a canvas (#1886): its `index.html`, its revision, and
 * the pages-route base its relative paths load from, signed for this Mockup.
 * Null when the canvas has no such Mockup.
 */
export async function mockupPageFor(
  room: RoomDoc | RoomReader,
  store: FileStore,
  fileId: string
): Promise<MockupPageResponse | null> {
  const page = await mockupFolderOn(room, store).page(fileId)
  if (!page) return null
  const base = mockupPageBase(room.roomId, page.fileId, page.revision)
  return {
    html: page.html,
    revision: page.revision,
    base: base.path,
    expiresAt: base.expiresAt,
  }
}
