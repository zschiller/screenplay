"use client"

import { useCallback, useMemo, useSyncExternalStore } from "react"
import {
  parseWorkspaceListView,
  readWorkspaceListView,
  workspaceListViewKey,
  writeWorkspaceListView,
  type WorkspaceListView,
} from "@/lib/workspace-list-view"

// Views written in this tab; other tabs announce theirs with `storage`.
const listeners = new Set<() => void>()

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange)
  window.addEventListener("storage", onChange)
  return () => {
    listeners.delete(onChange)
    window.removeEventListener("storage", onChange)
  }
}

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

/**
 * The member's Workspaces list view for this canvas (#885), read from this
 * browser's storage (the server render uses the default) and written back on
 * every change. Never the room doc.
 */
export function useWorkspaceListView(
  userId: string,
  roomId: string
): [WorkspaceListView, (patch: Partial<WorkspaceListView>) => void] {
  const key = workspaceListViewKey(userId, roomId)
  const raw = useSyncExternalStore(
    subscribe,
    () => readRaw(key),
    () => null
  )
  const view = useMemo(() => parseWorkspaceListView(raw), [raw])
  const update = useCallback(
    (patch: Partial<WorkspaceListView>) => {
      const current = readWorkspaceListView(userId, roomId)
      writeWorkspaceListView(userId, roomId, { ...current, ...patch })
      for (const listener of listeners) listener()
    },
    [userId, roomId]
  )
  return [view, update]
}
