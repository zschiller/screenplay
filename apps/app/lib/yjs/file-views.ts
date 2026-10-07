import * as Y from "yjs"
import type {
  LayerFileData,
  LayerFileKind,
  MarkdownLayerData,
  MockupLayerData,
} from "@/lib/types"

/**
 * Files and views (#1883, spec #1882). A Document or Mockup is a **file**
 * (`layerFiles`: title, kind, last chat, a Mockup's page state); each layer on
 * the canvas is a **view** of one file (`markdownLayers` / `mockupLayers`:
 * size, and a Mockup's fit and scroll), pointing at it by `fileId`. Bodies
 * are keyed by the file id.
 *
 * {@link FileViewCollection} reads a view with its file's fields on it, so a
 * reader sees one record as before, and routes each written field to where
 * it lives. A view from before #1883 carries its file's fields itself, under
 * its own id: {@link migrateFileViews} splits it on load, and until then a
 * read takes them from the view and a write splits that one view first.
 */

type AnyMap = Y.Map<unknown>

/** The fields that belong to a file, whatever its kind. */
const COMMON_FILE_FIELDS = ["title", "lastChangedByChatId", "ownerChatId"]

/** The fields of each kind's file. Every other field is the view's. */
export const FILE_FIELDS: Record<LayerFileKind, ReadonlySet<string>> = {
  document: new Set(COMMON_FILE_FIELDS),
  // A Mockup's page state is the file's: every view shows the same page.
  mockup: new Set([
    ...COMMON_FILE_FIELDS,
    "knobs",
    "knobValues",
    "sharedState",
    "live",
    "liveBranchId",
    "colorScheme",
    // The folder (#1886): every view reloads when it changes.
    "revision",
    "copyOf",
  ]),
}

/** A view as stored: everything but its file's fields. */
type StoredView = Record<string, unknown> & { id?: string; fileId?: string }

/** The file a stored view points at: its `fileId`, else its own id. */
function storedFileId(id: string, view: AnyMap): string {
  const fileId = view.get("fileId")
  return typeof fileId === "string" && fileId ? fileId : id
}

/** Whether a stored view still carries its file's fields (from before #1883). */
function isLegacyView(view: AnyMap): boolean {
  return !view.has("fileId")
}

/**
 * The views of one kind of file, read with the file's fields on them. The
 * same surface as a {@link import("./schema").YjsCollection}: `get`, `has`,
 * `toArray`, `toMap`, `set`, `update`, `delete`, `observe`.
 */
export class FileViewCollection<T extends MarkdownLayerData | MockupLayerData> {
  private snapshotCache: T[] | null = null
  private mapCache: ReadonlyMap<string, T> | null = null
  /** Each view's merged object while observed, kept until it or its file
   *  changes, as `YjsCollection` keeps its entries. */
  private entryCache = new Map<string, T>()
  private listeners = new Set<() => void>()
  private observerAttached = false
  private readonly fileFields: ReadonlySet<string>

  constructor(
    private readonly doc: Y.Doc,
    private readonly views: Y.Map<AnyMap>,
    private readonly files: Y.Map<AnyMap>,
    private readonly kind: LayerFileKind
  ) {
    this.fileFields = FILE_FIELDS[kind]
  }

  has(id: string): boolean {
    return this.views.has(id)
  }

  get(id: string): T | undefined {
    const view = this.views.get(id)
    return view ? this.resolve(id, view) : undefined
  }

  /** Iteration-stable array snapshot while observed; fresh otherwise. */
  toArray(): T[] {
    if (this.snapshotCache) return this.snapshotCache
    const arr: T[] = []
    this.views.forEach((view, id) => arr.push(this.entry(id, view)))
    if (this.observerAttached) this.snapshotCache = arr
    return arr
  }

  toMap(): ReadonlyMap<string, T> {
    if (this.mapCache) return this.mapCache
    const m = new Map<string, T>()
    this.views.forEach((view, id) => m.set(id, this.entry(id, view)))
    if (this.observerAttached) this.mapCache = m
    return m
  }

  /** The file id the view `id` shows, or undefined when there's no view. */
  fileIdOf(id: string): string | undefined {
    const view = this.views.get(id)
    return view ? storedFileId(id, view) : undefined
  }

  /** The ids of every view of `fileId`. */
  viewIdsOf(fileId: string): string[] {
    const ids: string[] = []
    this.views.forEach((view, id) => {
      if (storedFileId(id, view) === fileId) ids.push(id)
    })
    return ids
  }

  /**
   * Writes a view and its file. `fileId` names the file it shows (its own id
   * when unset): a new file is made with the file's fields, an existing one
   * takes them.
   */
  set(id: string, value: T): void {
    this.doc.transact(() => {
      const fileId = value.fileId || id
      const viewFields: StoredView = { fileId }
      const fileFields: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        if (k === "id" || k === "fileId") continue
        if (this.fileFields.has(k)) fileFields[k] = v
        else viewFields[k] = v
      }
      writeEntry(this.views, id, { id, ...viewFields })
      writeEntry(this.files, fileId, {
        ...fileFields,
        id: fileId,
        kind: this.kind,
        title: typeof fileFields.title === "string" ? fileFields.title : "",
      })
    })
  }

  /**
   * Writes a new view of the existing file `fileId`, with only the view's
   * fields: the file keeps its own.
   */
  addView(id: string, fileId: string, fields: Record<string, unknown>): void {
    this.doc.transact(() => {
      const view: StoredView = { id, fileId }
      for (const [k, v] of Object.entries(fields))
        if (!this.fileFields.has(k) && k !== "id" && k !== "fileId") view[k] = v
      writeEntry(this.views, id, view)
    })
  }

  /** Merges a partial onto a view and its file; a no-op without the view. */
  update(id: string, partial: Partial<T>): void {
    this.doc.transact(() => {
      const view = this.views.get(id)
      if (!view) return
      if (isLegacyView(view)) splitView(this.files, id, view, this.kind)
      const fileId = storedFileId(id, view)
      const file = this.files.get(fileId)
      for (const [k, v] of Object.entries(partial)) {
        if (k === "id" || k === "fileId") continue
        const target = this.fileFields.has(k) ? file : view
        if (!target) continue
        if (v === undefined) target.delete(k)
        else target.set(k, v as unknown)
      }
    })
  }

  /**
   * Removes a view. Until Delete file lands (#1882), a file goes with its last
   * view, as a layer went before; its body stays in the doc, as on every
   * delete, so ⌘Z brings it all back.
   */
  delete(id: string): void {
    const view = this.views.get(id)
    if (!view) return
    const fileId = storedFileId(id, view)
    this.doc.transact(() => {
      this.views.delete(id)
      if (this.viewIdsOf(fileId).length === 0) this.files.delete(fileId)
    })
  }

  /** Subscribe to changes of the views or their files. */
  observe(cb: () => void): () => void {
    this.listeners.add(cb)
    if (!this.observerAttached) {
      this.views.observeDeep(this.handleViewChange)
      this.files.observeDeep(this.handleFileChange)
      this.observerAttached = true
    }
    return () => {
      this.listeners.delete(cb)
      if (this.listeners.size === 0 && this.observerAttached) {
        this.views.unobserveDeep(this.handleViewChange)
        this.files.unobserveDeep(this.handleFileChange)
        this.observerAttached = false
        this.entryCache.clear()
        this.snapshotCache = null
        this.mapCache = null
      }
    }
  }

  private entry(id: string, view: AnyMap): T {
    if (!this.observerAttached) return this.resolve(id, view)
    let obj = this.entryCache.get(id)
    if (!obj) {
      obj = this.resolve(id, view)
      this.entryCache.set(id, obj)
    }
    return obj
  }

  private resolve(id: string, view: AnyMap): T {
    const stored = view.toJSON() as StoredView
    const fileId = storedFileId(id, view)
    const file = this.files.get(fileId)
    if (!file || isLegacyView(view)) {
      // Not split yet: the view still carries its file's fields.
      return { ...stored, id, fileId, title: stored.title ?? "" } as T
    }
    const merged: Record<string, unknown> = { id, fileId }
    for (const [k, v] of Object.entries(stored)) {
      if (!this.fileFields.has(k)) merged[k] = v
    }
    for (const [k, v] of Object.entries(file.toJSON())) {
      if (this.fileFields.has(k)) merged[k] = v
    }
    merged.id = id
    merged.fileId = fileId
    if (typeof merged.title !== "string") merged.title = ""
    return merged as T
  }

  private changed(): void {
    this.snapshotCache = null
    this.mapCache = null
    for (const listener of this.listeners) listener()
  }

  private handleViewChange = (
    events: Array<Y.YEvent<Y.AbstractType<unknown>>>
  ) => {
    for (const event of events) {
      if (event.target === this.views) {
        for (const id of event.keys.keys()) this.entryCache.delete(id)
      } else {
        const id = event.path[0]
        if (typeof id === "string") this.entryCache.delete(id)
        else this.entryCache.clear()
      }
    }
    this.changed()
  }

  private handleFileChange = (
    events: Array<Y.YEvent<Y.AbstractType<unknown>>>
  ) => {
    const fileIds = new Set<string>()
    for (const event of events) {
      if (event.target === this.files) {
        for (const id of event.keys.keys()) fileIds.add(id)
      } else {
        const id = event.path[0]
        if (typeof id === "string") fileIds.add(id)
      }
    }
    // Only a change to a file one of these views shows repaints them.
    let touched = false
    this.views.forEach((view, id) => {
      if (fileIds.has(storedFileId(id, view))) {
        this.entryCache.delete(id)
        touched = true
      }
    })
    if (touched) this.changed()
  }
}

/** Replaces one entry of a map of maps with `value`'s fields. */
function writeEntry(
  map: Y.Map<AnyMap>,
  id: string,
  value: Record<string, unknown>
): void {
  let inner = map.get(id)
  if (!inner) {
    inner = new Y.Map()
    map.set(id, inner)
  }
  const existing = new Set(inner.keys())
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined) continue
    inner.set(k, v)
    existing.delete(k)
  }
  for (const k of existing) inner.delete(k)
}

/**
 * Splits a view from before #1883 into its file (under the view's own id) and
 * the view. A file already there keeps its fields. Caller is in a transaction.
 */
function splitView(
  files: Y.Map<AnyMap>,
  id: string,
  view: AnyMap,
  kind: LayerFileKind
): void {
  const fields = FILE_FIELDS[kind]
  if (!files.has(id)) {
    const file: Record<string, unknown> = { id, kind, title: "" }
    for (const [k, v] of view.entries()) {
      if (fields.has(k) && v !== undefined) file[k] = v
    }
    writeEntry(files, id, file)
  }
  for (const k of [...view.keys()]) if (fields.has(k)) view.delete(k)
  view.set("fileId", id)
}

/**
 * The one-time migration (#1883): every Document and Mockup layer from before
 * files becomes a file plus one view under the same id, so links, mentions
 * and hover cards keep working. Idempotent; a no-op once every view is split.
 */
export function migrateFileViews(
  doc: Y.Doc,
  maps: {
    files: Y.Map<AnyMap>
    documents: Y.Map<AnyMap>
    mockups: Y.Map<AnyMap>
  }
): void {
  const pending: Array<[string, AnyMap, LayerFileKind]> = []
  maps.documents.forEach((view, id) => {
    if (isLegacyView(view)) pending.push([id, view, "document"])
  })
  maps.mockups.forEach((view, id) => {
    if (isLegacyView(view)) pending.push([id, view, "mockup"])
  })
  if (pending.length === 0) return
  doc.transact(() => {
    for (const [id, view, kind] of pending)
      splitView(maps.files, id, view, kind)
  })
}

/** The collections a file lookup reads. */
type FileLookup = {
  markdownLayers: FileViewCollection<MarkdownLayerData>
  mockupLayers: FileViewCollection<MockupLayerData>
  layerFiles: {
    has(id: string): boolean
    get(id: string): LayerFileData | undefined
  }
}

/**
 * The file an id names (#1883): a view's file, or the file itself. Mentions,
 * refs, hover cards and tool arguments name either, and resolve here.
 * Undefined when neither a view nor a file has that id.
 */
export function fileIdOf(c: FileLookup, id: string): string | undefined {
  return (
    c.markdownLayers.fileIdOf(id) ??
    c.mockupLayers.fileIdOf(id) ??
    (c.layerFiles.has(id) ? id : undefined)
  )
}

/** Every id that names a file: the file's own, then each of its views'. */
export function fileAndViewIds(c: FileLookup, fileId: string): string[] {
  const ids = new Set([
    fileId,
    ...c.markdownLayers.viewIdsOf(fileId),
    ...c.mockupLayers.viewIdsOf(fileId),
  ])
  return [...ids]
}

/**
 * The file an id names, view or file (see {@link fileIdOf}), as its record.
 * A view not split yet reads its file's fields off itself.
 */
export function layerFileOf(
  c: FileLookup,
  id: string
): LayerFileData | undefined {
  const fileId = fileIdOf(c, id)
  if (!fileId) return undefined
  const file = c.layerFiles.get(fileId)
  if (file) return file
  const kind: LayerFileKind = c.mockupLayers.has(id) ? "mockup" : "document"
  const view = c.mockupLayers.get(id) ?? c.markdownLayers.get(id)
  if (!view) return undefined
  const legacy: Record<string, unknown> = { id: fileId, kind }
  for (const [k, v] of Object.entries(view))
    if (FILE_FIELDS[kind].has(k)) legacy[k] = v
  return { title: "", ...legacy } as LayerFileData
}

/**
 * Merges file fields onto the file an id names, view or file (see
 * {@link fileIdOf}); a no-op when neither exists. Through a view, a view not
 * split yet is split first.
 */
export function updateLayerFile(
  c: FileLookup & {
    layerFiles: { update(id: string, partial: Partial<LayerFileData>): void }
  },
  id: string,
  partial: Partial<LayerFileData>
): void {
  if (c.markdownLayers.has(id))
    c.markdownLayers.update(id, partial as Partial<MarkdownLayerData>)
  else if (c.mockupLayers.has(id))
    c.mockupLayers.update(id, partial as Partial<MockupLayerData>)
  else c.layerFiles.update(id, partial)
}

/**
 * The view an id names among `views`, or else the first view of the file it
 * names: how a mention or ref finds what to show (#1883).
 */
export function findViewOrFile<T extends { id: string; fileId?: string }>(
  views: readonly T[],
  id: string
): T | undefined {
  return views.find((v) => v.id === id) ?? views.find((v) => v.fileId === id)
}
