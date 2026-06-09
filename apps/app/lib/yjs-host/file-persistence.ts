import "server-only"

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import * as Y from "yjs"
import type { Persistence, WSSharedDoc } from "y-websocket/bin/utils"

/**
 * Disk persistence for the local Yjs host. Each room's Y.Doc is stored as a
 * single file holding its full encoded state (`Y.encodeStateAsUpdate`). This is
 * the seam y-websocket's `setPersistence` expects: `bindState` loads a doc's
 * state from disk and subscribes to keep it written; `writeState` flushes on
 * the last disconnect.
 *
 * A whole-state-per-room file (rather than an append log à la y-leveldb) keeps
 * the implementation dependency-free and trivially correct for a single-user
 * local app: writes are atomic (temp file + rename) and a reload simply applies
 * the one stored update. The trade-off — rewriting the full state on every
 * change — is fine at single-user scale.
 */
export class FileYjsPersistence implements Persistence {
  readonly dir: string

  /**
   * Resolves once a doc's persisted state has been applied. y-websocket calls
   * `bindState` synchronously from `getYDoc` but doesn't await it, so the host
   * awaits this before reading/mutating to avoid racing the disk load.
   */
  private readonly loaded = new Map<string, Promise<void>>()

  /** Pending debounced flushes, so rapid edits coalesce into one write. */
  private readonly flushTimers = new Map<string, NodeJS.Timeout>()

  private static readonly FLUSH_DELAY_MS = 200

  constructor(dir: string) {
    this.dir = dir
  }

  private fileFor(docName: string): string {
    // Room ids are uuids/opaque strings; encode to keep them filesystem-safe.
    return path.join(this.dir, `${encodeURIComponent(docName)}.ydoc`)
  }

  bindState(docName: string, ydoc: WSSharedDoc): void {
    const load = this.load(docName, ydoc)
    this.loaded.set(docName, load)

    // Persist on every change. The handler is removed when the doc is
    // destroyed (y-websocket destroys docs on last disconnect), so we don't
    // need to detach it explicitly.
    ydoc.on("update", () => this.scheduleFlush(docName, ydoc))
  }

  private async load(docName: string, ydoc: WSSharedDoc): Promise<void> {
    try {
      const data = await readFile(this.fileFor(docName))
      if (data.byteLength > 0) Y.applyUpdate(ydoc, new Uint8Array(data))
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err
      // No persisted state yet — first time this room is opened.
    }
  }

  /** Await the disk load for a room (a no-op once already loaded). */
  whenLoaded(docName: string): Promise<void> {
    return this.loaded.get(docName) ?? Promise.resolve()
  }

  private scheduleFlush(docName: string, ydoc: WSSharedDoc): void {
    if (this.flushTimers.has(docName)) return
    const timer = setTimeout(() => {
      this.flushTimers.delete(docName)
      void this.flush(docName, ydoc)
    }, FileYjsPersistence.FLUSH_DELAY_MS)
    // Don't keep the process alive solely for a pending flush.
    timer.unref?.()
    this.flushTimers.set(docName, timer)
  }

  /** Write a room's full current state to disk now. */
  async flush(docName: string, ydoc: WSSharedDoc): Promise<void> {
    const pending = this.flushTimers.get(docName)
    if (pending) {
      clearTimeout(pending)
      this.flushTimers.delete(docName)
    }
    await mkdir(this.dir, { recursive: true })
    const file = this.fileFor(docName)
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
    const update = Y.encodeStateAsUpdate(ydoc)
    await writeFile(tmp, update)
    await rename(tmp, file)
  }

  /**
   * y-websocket's last-disconnect hook — flush so nothing is lost. Best-effort:
   * y-websocket calls this fire-and-forget (`writeState(...).then(destroy)`), so
   * a transient fs error here must not surface as an unhandled rejection or
   * crash the sidecar. Mutations are already flushed durably by `mutateDoc`.
   */
  async writeState(docName: string, ydoc: WSSharedDoc): Promise<void> {
    try {
      await this.flush(docName, ydoc)
    } catch (err) {
      console.warn(
        `yjs-host: failed to persist room ${docName} on disconnect`,
        err
      )
    }
  }

  /** Remove a room's persisted state from disk. */
  async deleteRoom(docName: string): Promise<void> {
    this.loaded.delete(docName)
    const pending = this.flushTimers.get(docName)
    if (pending) {
      clearTimeout(pending)
      this.flushTimers.delete(docName)
    }
    await rm(this.fileFor(docName), { force: true })
  }
}
