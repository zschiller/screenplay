"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import * as Y from "yjs"
import { UndoManager } from "yjs"
import type { ChatBroadcastEvent } from "@/lib/chat-store"
import { useYjs, type AwarenessLike } from "@/lib/yjs/context"
import {
  COLLECTION_KEYS,
  getRoomCollections,
  type RoomCollections,
  type YjsCollection,
  type YjsSingleton,
} from "@/lib/yjs/schema"
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

export function useRoomCollections(): RoomCollections {
  const { doc } = useYjs()
  return useMemo(() => getRoomCollections(doc), [doc])
}

function useCollectionArray<T extends Record<string, unknown>>(
  collection: YjsCollection<T>,
): Array<T> {
  const subscribe = useCallback(
    (cb: () => void) => collection.observe(cb),
    [collection],
  )
  const getSnapshot = useCallback(() => collection.toArray(), [collection])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function useCollectionMap<T extends Record<string, unknown>>(
  collection: YjsCollection<T>,
): ReadonlyMap<string, T> {
  const subscribe = useCallback(
    (cb: () => void) => collection.observe(cb),
    [collection],
  )
  const getSnapshot = useCallback(() => collection.toMap(), [collection])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function useSingleton<T extends Record<string, unknown>>(
  singleton: YjsSingleton<T>,
): T | null {
  const subscribe = useCallback(
    (cb: () => void) => singleton.observe(cb),
    [singleton],
  )
  const getSnapshot = useCallback(() => singleton.get(), [singleton])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useArtboards(): Array<ArtboardData> {
  return useCollectionArray(useRoomCollections().artboards)
}

export function useArtboardGroups(): Array<ArtboardGroupData> {
  return useCollectionArray(useRoomCollections().artboardGroups)
}

export function useTextLayers(): Array<TextLayerData> {
  return useCollectionArray(useRoomCollections().textLayers)
}

export function useWorkspaces(): Array<WorkspaceData> {
  return useCollectionArray(useRoomCollections().workspaces)
}

export function useAgents(): Array<AgentData> {
  return useCollectionArray(useRoomCollections().agents)
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
 * Yjs undo/redo scoped to room storage. Tracks the top-level domain Y.Maps
 * — text fragments (`text-{layerId}`) have their own UndoManager owned by
 * the TipTap editor, so they're not double-tracked here.
 */
export function useYjsHistory() {
  const { doc } = useYjs()
  const undoMgrRef = useRef<UndoManager | null>(null)

  useEffect(() => {
    const mgr = new UndoManager(
      [
        doc.getMap(COLLECTION_KEYS.workspaces),
        doc.getMap(COLLECTION_KEYS.agents),
        doc.getMap(COLLECTION_KEYS.artboards),
        doc.getMap(COLLECTION_KEYS.artboardGroups),
        doc.getMap(COLLECTION_KEYS.textLayers),
        doc.getMap(COLLECTION_KEYS.chatSessions),
        doc.getMap(COLLECTION_KEYS.plans),
      ],
      { captureTimeout: 500 },
    )
    undoMgrRef.current = mgr
    return () => {
      mgr.destroy()
      undoMgrRef.current = null
    }
  }, [doc])

  return useMemo(
    () => ({
      undo: () => undoMgrRef.current?.undo(),
      redo: () => undoMgrRef.current?.redo(),
    }),
    [],
  )
}

/**
 * Subscribe to per-entry changes for a domain. Returns a stable
 * function that yields the latest entry by id. Use sparingly — most
 * callers want the array hook.
 */
export function useCollectionEntry<T extends Record<string, unknown>>(
  collection: YjsCollection<T>,
  id: string,
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
  selectedArtboardIds: string[]
  selectedTextLayerIds: string[]
  // Figma-style cursor chat. Absent or `null` while the user isn't chatting;
  // an empty string while the bubble is open but nothing has been typed yet.
  message?: string | null
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
      const current = awareness.getLocalState() as Partial<CanvasPresence> | null
      awareness.setLocalState({ ...(current ?? {}), ...partial })
    },
    [awareness],
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
function useAwarenessSnapshot<T>(select: (a: AwarenessLike) => T): T {
  const awareness = useAwareness()
  const cacheRef = useRef<T | typeof EMPTY>(EMPTY)
  const versionRef = useRef(0)

  // Bump version on every awareness update; getSnapshot rebuilds when the
  // version it last saw differs from the current one.
  const lastVersionSeenRef = useRef(-1)

  const subscribe = useCallback(
    (cb: () => void) => {
      const handler = () => {
        versionRef.current += 1
        cb()
      }
      awareness.on("update", handler)
      return () => awareness.off("update", handler)
    },
    [awareness],
  )

  const getSnapshot = useCallback(() => {
    if (cacheRef.current === EMPTY || lastVersionSeenRef.current !== versionRef.current) {
      cacheRef.current = select(awareness)
      lastVersionSeenRef.current = versionRef.current
    }
    return cacheRef.current as T
  }, [awareness, select])

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

/** Other peers' awareness states. Stable reference between awareness changes. */
export function useOtherPresences(): Array<{
  clientId: number
  presence: CanvasPresence
}> {
  return useAwarenessSnapshot(SELECT_OTHERS)
}

export function useSelfPresence(): CanvasPresence | null {
  return useAwarenessSnapshot(SELECT_SELF)
}

export function useSelfClientId(): number {
  const awareness = useAwareness()
  return awareness.doc.clientID
}

/** Force-rerender hook used internally — exported for legacy patterns. */
export function useY(doc: Y.Doc) {
  const [, set] = useState(0)
  useEffect(() => {
    const handler = () => set((n) => n + 1)
    doc.on("update", handler)
    return () => doc.off("update", handler)
  }, [doc])
}

/**
 * Subscribe to the agent stream events written into the Y.Doc by the agent
 * routes. Calls `onEvent` for every new event from any chat. On mount, replays
 * events back to the most recent `chat-stream-start` for each chat so a late
 * joiner sees the in-progress stream; older events are ignored (chat history
 * is hydrated separately via the API).
 */
export function useChatStreamEvents(onEvent: (event: ChatBroadcastEvent) => void) {
  const { doc } = useYjs()
  const onEventRef = useRef(onEvent)
  onEventRef.current = onEvent

  useEffect(() => {
    const map = doc.getMap("streamEventsByChat") as Y.Map<Y.Array<ChatBroadcastEvent>>
    const cursors = new Map<string, number>()

    function findActiveStreamStart(arr: Y.Array<ChatBroadcastEvent>): number {
      const items = arr.toArray()
      for (let i = items.length - 1; i >= 0; i--) {
        if (items[i]?.type === "chat-stream-start") return i
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
 * Live tracked-pin positions for selector-anchored comments, keyed by
 * threadId. Synced across clients in realtime via Yjs and persisted by the
 * room's Yjs server, so a freshly-loaded canvas can render every pin at its
 * last-seen position without waiting for the iframe / dev server / bridge.
 */
export function useCommentPositions(): ReadonlyMap<
  string,
  { x: number; y: number }
> {
  return useCollectionMap(useRoomCollections().commentPositions)
}

/**
 * Setter for {@link useCommentPositions}. Call on every successful selector
 * resolve so the cached position stays current for late-joining clients and
 * subsequent reloads.
 */
export function useSetCommentPosition(): (
  threadId: string,
  x: number,
  y: number,
) => void {
  const { commentPositions } = useRoomCollections()
  return useCallback(
    (threadId, x, y) => commentPositions.set(threadId, { x, y }),
    [commentPositions],
  )
}

/**
 * Bulk-prune cached comment positions to the given set of live thread ids.
 * Called when the threads list changes so deleted/resolved threads don't
 * accumulate in the Yjs doc forever.
 */
export function usePruneCommentPositions(): (liveIds: Set<string>) => void {
  const { commentPositions, transact } = useRoomCollections()
  return useCallback(
    (liveIds) => {
      const stale: string[] = []
      for (const id of commentPositions.toMap().keys()) {
        if (!liveIds.has(id)) stale.push(id)
      }
      if (stale.length === 0) return
      transact(() => {
        for (const id of stale) commentPositions.delete(id)
      })
    },
    [commentPositions, transact],
  )
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
    [meta],
  )
  const getSnapshot = useCallback(
    () => (meta.get("commentsRevision") as number | undefined) ?? 0,
    [meta],
  )
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
