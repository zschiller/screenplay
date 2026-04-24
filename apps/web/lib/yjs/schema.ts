import * as Y from "yjs"
import type {
  AgentData,
  ArtboardData,
  ChatSessionData,
  PlanData,
  TextLayerData,
  ViewportData,
  WorkspaceData,
} from "@/lib/liveblocks.types"

/**
 * Y.Doc layout for a room. Each domain is a top-level Y.Map of Y.Maps; the
 * inner Y.Map stores object fields. Per-field LWW lets two clients editing
 * different fields of the same entry merge cleanly. Editor text fragments
 * (`text-{layerId}`) live alongside these but are owned by TipTap and not
 * touched here.
 */

export const COLLECTION_KEYS = {
  workspaces: "workspaces",
  agents: "sandboxes",
  artboards: "artboards",
  textLayers: "textLayers",
  chatSessions: "chatSessions",
  plans: "plans",
} as const

const META_KEY = "meta"
const VIEWPORT_FIELD = "savedViewport"

type AnyMap = Y.Map<unknown>

function ensureCollection(doc: Y.Doc, key: string): Y.Map<AnyMap> {
  return doc.getMap(key) as Y.Map<AnyMap>
}

function plain<T>(map: AnyMap | undefined): T | undefined {
  if (!map) return undefined
  return map.toJSON() as T
}

/**
 * Typed wrapper around a `Y.Map<Y.Map>` representing a collection of records.
 *
 * - `set` replaces the entire entry (deleting fields not in the new value).
 * - `update` merges a partial onto an existing entry; no-op if missing.
 * - All writes are wrapped in `doc.transact` so concurrent mutations within a
 *   single call land as one update on the wire and one undo step.
 */
export class YjsCollection<T extends Record<string, unknown>> {
  private snapshotCache: T[] | null = null
  private mapCache: ReadonlyMap<string, T> | null = null
  private listeners = new Set<() => void>()
  private observerAttached = false

  constructor(
    private readonly doc: Y.Doc,
    private readonly map: Y.Map<AnyMap>,
  ) {}

  has(id: string): boolean {
    return this.map.has(id)
  }

  get(id: string): T | undefined {
    return plain<T>(this.map.get(id))
  }

  /** Iteration-stable array snapshot. Reference is stable until the next mutation. */
  toArray(): T[] {
    if (this.snapshotCache) return this.snapshotCache as T[]
    const arr: T[] = []
    this.map.forEach((entry) => {
      const obj = plain<T>(entry)
      if (obj) arr.push(obj)
    })
    this.snapshotCache = arr
    return arr
  }

  toMap(): ReadonlyMap<string, T> {
    if (this.mapCache) return this.mapCache
    const m = new Map<string, T>()
    this.map.forEach((entry, id) => {
      const obj = plain<T>(entry)
      if (obj) m.set(id, obj)
    })
    this.mapCache = m
    return m
  }

  set(id: string, value: T): void {
    this.doc.transact(() => {
      let inner = this.map.get(id)
      if (!inner) {
        inner = new Y.Map()
        this.map.set(id, inner)
      }
      const existing = new Set(inner.keys())
      for (const [k, v] of Object.entries(value)) {
        inner.set(k, v as unknown)
        existing.delete(k)
      }
      for (const k of existing) inner.delete(k)
    })
  }

  update(id: string, partial: Partial<T>): void {
    this.doc.transact(() => {
      const inner = this.map.get(id)
      if (!inner) return
      for (const [k, v] of Object.entries(partial)) {
        if (v === undefined) inner.delete(k)
        else inner.set(k, v as unknown)
      }
    })
  }

  delete(id: string): void {
    this.map.delete(id)
  }

  /** Subscribe to changes. Returns an unsubscribe function. */
  observe(cb: () => void): () => void {
    this.listeners.add(cb)
    if (!this.observerAttached) {
      this.map.observeDeep(this.handleChange)
      this.observerAttached = true
    }
    return () => {
      this.listeners.delete(cb)
      if (this.listeners.size === 0 && this.observerAttached) {
        this.map.unobserveDeep(this.handleChange)
        this.observerAttached = false
      }
    }
  }

  private handleChange = () => {
    this.snapshotCache = null
    this.mapCache = null
    for (const listener of this.listeners) listener()
  }
}

/**
 * Singleton object wrapper — for the `savedViewport`-style pattern where the
 * "value" is a single object rather than a keyed collection.
 */
export class YjsSingleton<T extends Record<string, unknown>> {
  private snapshotCache: T | null | undefined = undefined
  private listeners = new Set<() => void>()
  private observerAttached = false

  constructor(
    private readonly doc: Y.Doc,
    private readonly parent: AnyMap,
    private readonly field: string,
  ) {}

  get(): T | null {
    if (this.snapshotCache !== undefined) return this.snapshotCache
    const inner = this.parent.get(this.field) as AnyMap | undefined
    this.snapshotCache = inner ? (inner.toJSON() as T) : null
    return this.snapshotCache
  }

  set(value: T): void {
    this.doc.transact(() => {
      let inner = this.parent.get(this.field) as AnyMap | undefined
      if (!inner) {
        inner = new Y.Map()
        this.parent.set(this.field, inner)
      }
      const existing = new Set(inner.keys())
      for (const [k, v] of Object.entries(value)) {
        inner.set(k, v as unknown)
        existing.delete(k)
      }
      for (const k of existing) inner.delete(k)
    })
  }

  clear(): void {
    this.parent.delete(this.field)
  }

  observe(cb: () => void): () => void {
    this.listeners.add(cb)
    if (!this.observerAttached) {
      this.parent.observeDeep(this.handleChange)
      this.observerAttached = true
    }
    return () => {
      this.listeners.delete(cb)
      if (this.listeners.size === 0 && this.observerAttached) {
        this.parent.unobserveDeep(this.handleChange)
        this.observerAttached = false
      }
    }
  }

  private handleChange = () => {
    this.snapshotCache = undefined
    for (const listener of this.listeners) listener()
  }
}

export type RoomCollections = {
  doc: Y.Doc
  workspaces: YjsCollection<WorkspaceData>
  agents: YjsCollection<AgentData>
  artboards: YjsCollection<ArtboardData>
  textLayers: YjsCollection<TextLayerData>
  chatSessions: YjsCollection<ChatSessionData>
  plans: YjsCollection<PlanData>
  savedViewport: YjsSingleton<ViewportData>
  /** Run a function as a single Yjs transaction (one update, one undo step). */
  transact: (fn: () => void) => void
}

const COLLECTIONS_CACHE = new WeakMap<Y.Doc, RoomCollections>()

export function getRoomCollections(doc: Y.Doc): RoomCollections {
  const cached = COLLECTIONS_CACHE.get(doc)
  if (cached) return cached

  const meta = doc.getMap(META_KEY) as AnyMap
  const collections: RoomCollections = {
    doc,
    workspaces: new YjsCollection<WorkspaceData>(
      doc,
      ensureCollection(doc, COLLECTION_KEYS.workspaces),
    ),
    agents: new YjsCollection<AgentData>(
      doc,
      ensureCollection(doc, COLLECTION_KEYS.agents),
    ),
    artboards: new YjsCollection<ArtboardData>(
      doc,
      ensureCollection(doc, COLLECTION_KEYS.artboards),
    ),
    textLayers: new YjsCollection<TextLayerData>(
      doc,
      ensureCollection(doc, COLLECTION_KEYS.textLayers),
    ),
    chatSessions: new YjsCollection<ChatSessionData>(
      doc,
      ensureCollection(doc, COLLECTION_KEYS.chatSessions),
    ),
    plans: new YjsCollection<PlanData>(
      doc,
      ensureCollection(doc, COLLECTION_KEYS.plans),
    ),
    savedViewport: new YjsSingleton<ViewportData>(doc, meta, VIEWPORT_FIELD),
    transact: (fn) => doc.transact(fn),
  }
  COLLECTIONS_CACHE.set(doc, collections)
  return collections
}
