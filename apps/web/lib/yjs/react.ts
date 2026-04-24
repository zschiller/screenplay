"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import * as Y from "yjs"
import { UndoManager } from "yjs"
import { useYjs } from "@/components/providers/yjs-provider"
import type { ChatBroadcastEvent } from "@/lib/chat-store"
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
  ChatSessionData,
  PlanData,
  TextLayerData,
  ViewportData,
  WorkspaceData,
} from "@/lib/liveblocks.types"

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
