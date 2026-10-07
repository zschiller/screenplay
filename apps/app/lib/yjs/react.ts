"use client"

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react"
import * as Y from "yjs"
import { createCanvasUndo, type CanvasUndo } from "@/lib/canvas/undo"
import { orderedPages } from "@/lib/canvas/pages"
import type { ChatBroadcastEvent } from "@/lib/chat-store"
import {
  useOptionalYjs,
  useYjs,
  type AwarenessChange,
  type AwarenessLike,
} from "@/lib/yjs/context"
import { savedSkillsIn, type SavedSkill } from "@/lib/skills/saved"
import { mockupHtml } from "@/lib/yjs/mockup-html"
import {
  getRoomCollections,
  type RoomCollections,
  type YjsCollection,
  type YjsSingleton,
} from "@/lib/yjs/schema"
import type {
  BranchData,
  IframeLayerData,
  IframeLayerGroupData,
  ChatSessionData,
  MarkdownLayerData,
  FileEntryData,
  MemoryData,
  MockupLayerData,
  PageData,
  PlanData,
  PageViewData,
  ViewportData,
  RepoData,
} from "@/lib/types"

export function useRoomCollections(): RoomCollections {
  const { doc } = useYjs()
  return useMemo(() => getRoomCollections(doc), [doc])
}

function useCollectionArray<T extends Record<string, unknown>>(
  collection: YjsCollection<T>
): Array<T> {
  const subscribe = useCallback(
    (cb: () => void) => collection.observe(cb),
    [collection]
  )
  const getSnapshot = useCallback(() => collection.toArray(), [collection])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function useSingleton<T extends Record<string, unknown>>(
  singleton: YjsSingleton<T>
): T | null {
  const subscribe = useCallback(
    (cb: () => void) => singleton.observe(cb),
    [singleton]
  )
  const getSnapshot = useCallback(() => singleton.get(), [singleton])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useIframeLayers(): Array<IframeLayerData> {
  return useCollectionArray(useRoomCollections().iframeLayers)
}

export function useIframeLayerGroups(): Array<IframeLayerGroupData> {
  return useCollectionArray(useRoomCollections().iframeLayerGroups)
}

/** The canvas's Pages in list order (#1835); never empty. */
export function usePages(): PageData[] {
  const records = useCollectionArray(useRoomCollections().pages)
  return useMemo(() => orderedPages(records), [records])
}

/** Every member's view of every Page (#1838), `lib/canvas/page-views.ts`. */
export function usePageViews(): PageViewData[] {
  return useCollectionArray(useRoomCollections().pageViews)
}

export function useMarkdownLayers(): Array<MarkdownLayerData> {
  return useCollectionArray(useRoomCollections().markdownLayers)
}

export function useMockupLayers(): Array<MockupLayerData> {
  return useCollectionArray(useRoomCollections().mockupLayers)
}

/** A Layer as a list of names reads it: its id and title. */
export type TitledLayerName = { id: string; title: string }

/**
 * The ids and titles of a collection's Layers. Unlike the whole array, it
 * keeps its identity while a Layer only resizes, scrolls or changes its page
 * state, so a component that lists names doesn't re-render on every step of
 * a resize.
 */
function useCollectionTitles(
  collection: YjsCollection<MarkdownLayerData> | YjsCollection<MockupLayerData>
): TitledLayerName[] {
  const last = useRef<TitledLayerName[]>([])
  const subscribe = useCallback(
    (cb: () => void) => collection.observe(cb),
    [collection]
  )
  const getSnapshot = useCallback(() => {
    const items = collection.toArray()
    const prev = last.current
    const same =
      items.length === prev.length &&
      items.every((d, i) => d.id === prev[i]!.id && d.title === prev[i]!.title)
    if (!same) last.current = items.map(({ id, title }) => ({ id, title }))
    return last.current
  }, [collection])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useMarkdownLayerTitles(): TitledLayerName[] {
  return useCollectionTitles(useRoomCollections().markdownLayers)
}

export function useMockupLayerTitles(): TitledLayerName[] {
  return useCollectionTitles(useRoomCollections().mockupLayers)
}

/**
 * A Mockup Layer's title, kept current as it changes: `""` while untitled,
 * `undefined` once deleted or outside a room.
 */
export function useMockupTitle(id: string): string | undefined {
  const doc = useOptionalYjs()?.doc
  const collection = useMemo(
    () => (doc ? getRoomCollections(doc).mockupLayers : null),
    [doc]
  )
  const subscribe = useCallback(
    (cb: () => void) => collection?.observe(cb) ?? (() => {}),
    [collection]
  )
  const getSnapshot = useCallback(
    () => collection?.get(id)?.title,
    [collection, id]
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** A Mockup Layer's page, kept current as the shared `Y.Text` changes. */
export function useMockupHtml(layerId: string): string {
  const { doc } = useYjs()
  const text = useMemo(() => mockupHtml(doc, layerId), [doc, layerId])
  const subscribe = useCallback(
    (cb: () => void) => {
      text.observe(cb)
      return () => text.unobserve(cb)
    },
    [text]
  )
  const getSnapshot = useCallback(() => text.toString(), [text])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useRepos(): Array<RepoData> {
  return useCollectionArray(useRoomCollections().repos)
}

/** Canvas memory entries (#902), in the Room doc's order; sort before showing. */
export function useMemories(): Array<MemoryData> {
  return useCollectionArray(useRoomCollections().memories)
}

/** Canvas Files entries (#1514), for Canvas settings › Files. */
export function useCanvasFiles(): Array<FileEntryData> {
  return useCollectionArray(useRoomCollections().files)
}

/** The canvas's saved Skills (#1555), by name, live from the Room's doc. */
export function useCanvasSkills(): SavedSkill[] {
  const entries = useCollectionArray(useRoomCollections().skills)
  return useMemo(() => savedSkillsIn(entries), [entries])
}

export function useBranches(): Array<BranchData> {
  return useCollectionArray(useRoomCollections().branches)
}

export function useChatSessions(): Array<ChatSessionData> {
  return useCollectionArray(useRoomCollections().chatSessions)
}

export function usePlans(): Array<PlanData> {
  return useCollectionArray(useRoomCollections().plans)
}

export function useSavedViewport(): ViewportData | null {
  return useSingleton(useRoomCollections().savedViewport)
}

/**
 * ⌘Z / ⌘⇧Z for the canvas: this member's own edits to frames, documents,
 * Groups and memory (see `lib/canvas/undo.ts` for exactly what's tracked).
 * Text fragments (`text-{layerId}`) have their own UndoManager owned by the
 * TipTap editor, so they're not double-tracked here.
 */
export function useYjsHistory() {
  const { doc } = useYjs()
  const undoRef = useRef<CanvasUndo | null>(null)

  useEffect(() => {
    const undo = createCanvasUndo(doc)
    undoRef.current = undo
    return () => {
      undo.destroy()
      undoRef.current = null
    }
  }, [doc])

  return useMemo(
    () => ({
      undo: () => undoRef.current?.undo(),
      redo: () => undoRef.current?.redo(),
    }),
    []
  )
}

/**
 * Subscribe to per-entry changes for a domain. Returns a stable
 * function that yields the latest entry by id. Use sparingly — most
 * callers want the array hook.
 */
export function useCollectionEntry<T extends Record<string, unknown>>(
  collection: YjsCollection<T>,
  id: string
): T | undefined {
  const [, force] = useState(0)
  useEffect(() => collection.observe(() => force((n) => n + 1)), [collection])
  return collection.get(id)
}

// ---------------------------------------------------------------------------
// Awareness (presence) — replaces Liveblocks Presence/Self/Others
// ---------------------------------------------------------------------------

// `user` and `cursor` are reserved by y-prosemirror's cursor-plugin — it reads
// `awareness[clientId].cursor.{anchor,head}` as ProseMirror RelativePositions
// and overwrites `awareness[clientId].user` with `{ name, color }`. We publish
// under `identity` / `pointer` so the canvas pointer and profile stay intact
// once a TipTap text layer mounts alongside us.
export type CanvasPresence = {
  identity: { id: string; name: string; avatar?: string }
  pointer: { x: number; y: number } | null
  viewport: { x: number; y: number; zoom: number }
  color: string
  selectedIframeLayerIds: string[]
  // Members of groups this user has selected. Broadcast separately from
  // `selectedIframeLayerIds` so remote viewers can mirror the local
  // selection visuals exactly (outline every member, but draw the enclosing
  // union only for a mixed group-plus-frame selection, not a lone group).
  groupSelectedIframeLayerIds?: string[]
  // Figma-style cursor chat. Absent or `null` while the user isn't chatting;
  // an empty string while the bubble is open but nothing has been typed yet.
  message?: string | null
  // The canvas page (#1840) this user is looking at. Absent from clients
  // from before pages, which show the first page.
  pageId?: string
}

function useAwareness(): AwarenessLike {
  return useYjs().awareness
}

/**
 * Returns a setter that merges into the local awareness state. The first call
 * with a given field also triggers an awareness broadcast to peers.
 */
export function useSetPresence() {
  const awareness = useAwareness()
  return useCallback(
    (partial: Partial<CanvasPresence>) => {
      const current =
        awareness.getLocalState() as Partial<CanvasPresence> | null
      awareness.setLocalState({ ...(current ?? {}), ...partial })
    },
    [awareness]
  )
}

/**
 * Generic awareness snapshot hook. Caches the selected value and only rebuilds
 * on awareness updates — keeps `useSyncExternalStore` happy by returning a
 * reference-stable snapshot between updates.
 *
 * We listen to `update` rather than `change`: `change` doesn't fire on
 * local-only `setLocalState` calls (no remote peers means no broadcast),
 * which kept the local user out of `useSelfPresence` until someone else
 * joined. `update` fires on every local set as well, so the self avatar
 * appears immediately.
 */
function useAwarenessSnapshot<T>(
  select: (a: AwarenessLike) => T,
  /**
   * Optional gate on which client ids must change for this snapshot to rebuild.
   * `useOtherPresences` passes one so our own awareness writes — notably the
   * per-frame viewport broadcast during a pan — don't churn the peer snapshot
   * (and everything memoized on it) ~60x/s. Must be a stable reference.
   */
  isRelevant?: (changed: number[], selfId: number) => boolean,
  /**
   * Optional equality on rebuilt values: an equal result keeps the previous
   * snapshot, so subscribers re-render only when what they read changed.
   */
  isEqual?: (a: T, b: T) => boolean
): T {
  const awareness = useAwareness()
  const cacheRef = useRef<T | typeof EMPTY>(EMPTY)
  const versionRef = useRef(0)

  // Bump version on every awareness update; getSnapshot rebuilds when the
  // version it last saw differs from the current one.
  const lastVersionSeenRef = useRef(-1)

  const subscribe = useCallback(
    (cb: () => void) => {
      const handler = (changes?: AwarenessChange) => {
        // Skip updates that can't affect this selector. When the backend
        // doesn't supply a change-set we fall back to bumping on every update
        // (the prior behavior), so correctness never depends on it.
        if (isRelevant && changes) {
          const ids = [...changes.added, ...changes.updated, ...changes.removed]
          if (!isRelevant(ids, awareness.doc.clientID)) return
        }
        versionRef.current += 1
        cb()
      }
      awareness.on("update", handler)
      return () => awareness.off("update", handler)
    },
    [awareness, isRelevant]
  )

  const lastSelectRef = useRef(select)
  const getSnapshot = useCallback(() => {
    if (
      cacheRef.current === EMPTY ||
      lastVersionSeenRef.current !== versionRef.current ||
      lastSelectRef.current !== select
    ) {
      lastSelectRef.current = select
      const next = select(awareness)
      if (cacheRef.current === EMPTY || !isEqual?.(cacheRef.current as T, next))
        cacheRef.current = next
      lastVersionSeenRef.current = versionRef.current
    }
    return cacheRef.current as T
  }, [awareness, select, isEqual])

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

const EMPTY: unique symbol = Symbol("empty")

const SELECT_OTHERS = (a: AwarenessLike) => {
  const selfId = a.doc.clientID
  const result: Array<{ clientId: number; presence: CanvasPresence }> = []
  a.getStates().forEach((state, clientId) => {
    if (clientId === selfId) return
    const presence = state as Partial<CanvasPresence>
    if (!presence.identity || !presence.viewport) return
    result.push({ clientId, presence: presence as CanvasPresence })
  })
  return result
}

const SELECT_SELF = (a: AwarenessLike): CanvasPresence | null => {
  const state = a.getLocalState() as Partial<CanvasPresence> | null
  if (!state || !state.identity || !state.viewport) return null
  return state as CanvasPresence
}

/** Bump only when a non-self client changed. Our own awareness writes (e.g. the
 *  per-frame viewport broadcast during a pan) leave the peer set untouched, so
 *  ignoring them keeps `useOtherPresences` reference-stable across a pan. */
const OTHERS_RELEVANT = (changed: number[], selfId: number): boolean =>
  changed.some((id) => id !== selfId)

/** Other peers' awareness states. Stable reference between awareness changes. */
export function useOtherPresences(): Array<{
  clientId: number
  presence: CanvasPresence
}> {
  return useAwarenessSnapshot(SELECT_OTHERS, OTHERS_RELEVANT)
}

/**
 * A peer's presence without the fields that change on every move (pointer,
 * viewport, cursor-chat message): identity, colour and selection.
 */
export type PeerPresence = Omit<
  CanvasPresence,
  "pointer" | "viewport" | "message"
>

const sameIds = (a: string[] | undefined, b: string[] | undefined) => {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  return a.every((id, i) => id === b[i])
}

const samePeer = (a: PeerPresence, b: PeerPresence) =>
  a.identity.id === b.identity.id &&
  a.identity.name === b.identity.name &&
  a.identity.avatar === b.identity.avatar &&
  a.color === b.color &&
  a.pageId === b.pageId &&
  sameIds(a.selectedIframeLayerIds, b.selectedIframeLayerIds) &&
  sameIds(a.groupSelectedIframeLayerIds, b.groupSelectedIframeLayerIds)

type Peers = Array<{ clientId: number; presence: PeerPresence }>

const SAME_PEERS = (a: Peers, b: Peers) =>
  a.length === b.length &&
  a.every(
    (p, i) =>
      p.clientId === b[i]!.clientId && samePeer(p.presence, b[i]!.presence)
  )

/**
 * Other peers' identity, colour, page and selection. Unlike `useOtherPresences`, a
 * peer's cursor moving or canvas panning doesn't change it, so what reads it
 * doesn't re-render on every remote move. The `presence` objects keep their
 * pointer and viewport from when the snapshot was taken: don't read them.
 */
export function useOtherPeers(): Peers {
  return useAwarenessSnapshot(SELECT_OTHERS, OTHERS_RELEVANT, SAME_PEERS)
}

/** Where a followed peer is looking: their page and viewport. */
export type PeerView = Pick<CanvasPresence, "viewport" | "pageId">

/**
 * The page and viewport of the peer with this client id, `undefined` once
 * they're gone, or `null` when not following anyone.
 */
export function usePeerView(
  clientId: number | null
): PeerView | null | undefined {
  const select = useCallback(
    (a: AwarenessLike): PeerView | null | undefined => {
      if (clientId === null) return null
      const state = a.getStates().get(clientId) as
        Partial<CanvasPresence> | undefined
      if (!state?.identity || !state.viewport) return undefined
      return { viewport: state.viewport, pageId: state.pageId }
    },
    [clientId]
  )
  return useAwarenessSnapshot(select, OTHERS_RELEVANT, SAME_VIEW)
}

const SAME_VIEW = (
  a: PeerView | null | undefined,
  b: PeerView | null | undefined
) =>
  a === b ||
  (!!a &&
    !!b &&
    a.pageId === b.pageId &&
    a.viewport.x === b.viewport.x &&
    a.viewport.y === b.viewport.y &&
    a.viewport.zoom === b.viewport.zoom)

export function useSelfPresence(): CanvasPresence | null {
  return useAwarenessSnapshot(SELECT_SELF)
}

/** The local user's name, avatar and colour, plus their cursor-chat message. */
export type SelfIdentity = {
  name: string
  avatar: string | undefined
  color: string
  message: string | null
}

const SELECT_SELF_IDENTITY = (a: AwarenessLike): SelfIdentity | null => {
  const self = SELECT_SELF(a)
  if (!self) return null
  return {
    name: self.identity.name,
    avatar: self.identity.avatar,
    color: self.color,
    message: self.message ?? null,
  }
}

const SAME_SELF_IDENTITY = (a: SelfIdentity | null, b: SelfIdentity | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.name === b.name &&
    a.avatar === b.avatar &&
    a.color === b.color &&
    a.message === b.message)

/**
 * The local user's identity, without the pointer and viewport that change on
 * every move: our own cursor moves and pans don't re-render what reads this.
 */
export function useSelfIdentity(): SelfIdentity | null {
  return useAwarenessSnapshot(
    SELECT_SELF_IDENTITY,
    undefined,
    SAME_SELF_IDENTITY
  )
}

/**
 * Subscribe to the agent stream events written into the Y.Doc by the agent
 * routes. Calls `onEvent` for every new event from any chat. On mount, replays
 * events back to the most recent `chat-stream-start` for each chat so a late
 * joiner sees the in-progress stream; older events are ignored (chat history
 * is hydrated separately via the API).
 */
export function useChatStreamEvents(
  onEvent: (event: ChatBroadcastEvent) => void
) {
  const { doc } = useYjs()
  const onEventRef = useRef(onEvent)
  useEffect(() => {
    onEventRef.current = onEvent
  })

  useEffect(() => {
    const map = doc.getMap("streamEventsByChat") as Y.Map<
      Y.Array<ChatBroadcastEvent>
    >
    const cursors = new Map<string, number>()

    /**
     * Find the index to start replaying from for an in-progress stream. If
     * the most recent stream signal is `chat-stream-end`, the stream is over
     * and we skip the whole array — replaying a completed turn would
     * duplicate messages that `/api/agent/history` already returns. If a
     * `chat-stream-start` is the most recent signal, return its index so
     * late joiners catch up on the events emitted so far.
     */
    function findActiveStreamStart(arr: Y.Array<ChatBroadcastEvent>): number {
      const items = arr.toArray()
      for (let i = items.length - 1; i >= 0; i--) {
        const t = items[i]?.type
        if (t === "chat-stream-end") return items.length
        if (t === "chat-stream-start") return i
      }
      return items.length
    }

    function applyAll() {
      map.forEach((arr, chatId) => {
        let cursor = cursors.get(chatId)
        if (cursor === undefined) {
          // Initial: only replay an in-progress stream, not historical chatter.
          cursor = findActiveStreamStart(arr)
        } else if (arr.length < cursor) {
          // Array was trimmed (future cleanup) — fall back to the same logic.
          cursor = findActiveStreamStart(arr)
        }
        const items = arr.toArray()
        for (let i = cursor; i < items.length; i++) {
          const event = items[i]
          if (event) onEventRef.current(event)
        }
        cursors.set(chatId, items.length)
      })
    }

    const handler = () => applyAll()
    map.observeDeep(handler)
    applyAll()

    return () => {
      map.unobserveDeep(handler)
    }
  }, [doc])
}

/**
 * Subscribes to the room's comments revision counter — server-bumped on any
 * thread/comment change. Use the returned number as a refetch trigger.
 */
export function useCommentsRevision(): number {
  const { doc } = useYjs()
  const meta = useMemo(() => doc.getMap("meta"), [doc])
  const subscribe = useCallback(
    (cb: () => void) => {
      const handler = () => cb()
      meta.observe(handler)
      return () => meta.unobserve(handler)
    },
    [meta]
  )
  const getSnapshot = useCallback(
    () => (meta.get("commentsRevision") as number | undefined) ?? 0,
    [meta]
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/**
 * Subscribes to the acting user's read-state revision — server-bumped on any
 * mark-read/mark-unread by that user. Use the returned number as a refetch
 * trigger so a user's own read changes refresh their other tabs without
 * forcing every client in the room to refetch. Returns 0 when no user id is
 * known.
 */
export function useCommentsReadRevision(userId: string | null): number {
  const { doc } = useYjs()
  const read = useMemo(() => doc.getMap("commentsRead"), [doc])
  const subscribe = useCallback(
    (cb: () => void) => {
      const handler = () => cb()
      read.observe(handler)
      return () => read.unobserve(handler)
    },
    [read]
  )
  const getSnapshot = useCallback(
    () => (userId ? ((read.get(userId) as number | undefined) ?? 0) : 0),
    [read, userId]
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
