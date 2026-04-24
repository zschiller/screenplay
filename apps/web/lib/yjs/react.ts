"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import * as Y from "yjs"
import { UndoManager } from "yjs"
import { useYjs } from "@/components/providers/yjs-provider"
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
