import * as Y from "yjs"
import { nanoid } from "nanoid"
import type {
  AgentData,
  ArtboardData,
  ArtboardGroupData,
  ChatSessionData,
  PlanData,
  TextLayerData,
  ViewportData,
  WorkspaceData,
} from "@/lib/types"

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
  artboardGroups: "artboardGroups",
  textLayers: "textLayers",
  chatSessions: "chatSessions",
  plans: "plans",
  // Live tracked-pin positions for selector-anchored comments. Keyed by
  // threadId; value is the artboard-local (x, y) of the pin. Synced across
  // clients so everyone sees the pin at the same place even before their
  // dev server / iframe is ready.
  commentPositions: "commentPositions",
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

export type CommentPosition = { x: number; y: number }

export type RoomCollections = {
  doc: Y.Doc
  workspaces: YjsCollection<WorkspaceData>
  agents: YjsCollection<AgentData>
  artboards: YjsCollection<ArtboardData>
  artboardGroups: YjsCollection<ArtboardGroupData>
  textLayers: YjsCollection<TextLayerData>
  chatSessions: YjsCollection<ChatSessionData>
  plans: YjsCollection<PlanData>
  commentPositions: YjsCollection<CommentPosition>
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
    artboardGroups: new YjsCollection<ArtboardGroupData>(
      doc,
      ensureCollection(doc, COLLECTION_KEYS.artboardGroups),
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
    commentPositions: new YjsCollection<CommentPosition>(
      doc,
      ensureCollection(doc, COLLECTION_KEYS.commentPositions),
    ),
    savedViewport: new YjsSingleton<ViewportData>(doc, meta, VIEWPORT_FIELD),
    transact: (fn) => doc.transact(fn),
  }
  migrateLegacyArtboards(collections)
  COLLECTIONS_CACHE.set(doc, collections)
  return collections
}

/**
 * Wraps any artboard that predates groups (i.e. still carries its own x/y and
 * isn't already referenced by a group) in a fresh single-artboard group, and
 * back-fills `name` on any group that lacks one. Runs once per Y.Doc in
 * `getRoomCollections`. Idempotent.
 */
function migrateLegacyArtboards(c: RoomCollections): void {
  const doc = c.doc
  const artboardsMap = ensureCollection(doc, COLLECTION_KEYS.artboards)
  const groupsMap = ensureCollection(doc, COLLECTION_KEYS.artboardGroups)

  const referenced = new Set<string>()
  groupsMap.forEach((groupMap) => {
    const ids = groupMap.get("artboardIds") as string[] | undefined
    if (Array.isArray(ids)) for (const id of ids) referenced.add(id)
  })

  const orphans: { id: string; x: number; y: number; sidebarOrder?: number }[] = []
  artboardsMap.forEach((abMap, id) => {
    if (referenced.has(id)) return
    const x = abMap.get("x") as number | undefined
    const y = abMap.get("y") as number | undefined
    if (typeof x !== "number" || typeof y !== "number") return
    const sidebarOrder = abMap.get("sidebarOrder") as number | undefined
    orphans.push({ id, x, y, sidebarOrder })
  })

  // Collect groups that already exist but were created before names were
  // persisted, so we can back-fill them. Iteration order is sidebarOrder
  // first (lower = earlier), then doc order, then id — same as the sidebar.
  const unnamed: Array<{ id: string; sidebarOrder: number; docIdx: number }> = []
  let docIdx = 0
  let maxNumber = 0
  groupsMap.forEach((groupMap, id) => {
    const name = groupMap.get("name") as string | undefined
    if (name) {
      const m = /^Group (\d+)$/.exec(name)
      if (m) {
        const n = parseInt(m[1]!, 10)
        if (Number.isFinite(n) && n > maxNumber) maxNumber = n
      }
    } else {
      const so = groupMap.get("sidebarOrder")
      const sidebarOrder = typeof so === "number" ? so : Number.MAX_SAFE_INTEGER
      unnamed.push({ id, sidebarOrder, docIdx })
    }
    docIdx++
  })
  unnamed.sort((a, b) => {
    if (a.sidebarOrder !== b.sidebarOrder) return a.sidebarOrder - b.sidebarOrder
    if (a.docIdx !== b.docIdx) return a.docIdx - b.docIdx
    return a.id.localeCompare(b.id)
  })

  if (orphans.length === 0 && unnamed.length === 0) return

  doc.transact(() => {
    let nextNumber = maxNumber + 1
    for (const u of unnamed) {
      const g = groupsMap.get(u.id)
      if (g && !g.get("name")) {
        g.set("name", `Group ${nextNumber++}`)
      }
    }
    for (const orphan of orphans) {
      const groupId = nanoid()
      c.artboardGroups.set(groupId, {
        id: groupId,
        name: `Group ${nextNumber++}`,
        x: orphan.x,
        y: orphan.y,
        artboardIds: [orphan.id],
        ...(orphan.sidebarOrder !== undefined ? { sidebarOrder: orphan.sidebarOrder } : {}),
      })
      const ab = artboardsMap.get(orphan.id)
      if (ab) {
        ab.delete("x")
        ab.delete("y")
        ab.delete("sidebarOrder")
      }
    }
  })
}
