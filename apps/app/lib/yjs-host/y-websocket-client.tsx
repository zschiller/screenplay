"use client"

import {
  useCallback,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import { WebsocketProvider } from "y-websocket"
import * as Y from "yjs"
import {
  YjsConnectionProvider,
  type AwarenessLike,
  type YjsConnection,
} from "@/lib/yjs/context"

/**
 * Local Yjs host client. Connects the webview to the sidecar's y-websocket
 * server over `ws://localhost` and exposes the same `{ doc, awareness }`
 * surface as the Liveblocks client, so `useYjs()` consumers don't change.
 *
 * The sidecar holds the authoritative Y.Doc; this provider is a plain peer that
 * syncs against it. Mirrors `liveblocks-client.tsx`'s sync-gate behaviour.
 */
function websocketUrl(): string {
  // `NEXT_PUBLIC_YJS_WS_PORT` is inlined at build; default matches the
  // server's default port. Use the page host so it works whether the webview
  // loads from `localhost` or `127.0.0.1`.
  const port = process.env.NEXT_PUBLIC_YJS_WS_PORT || "1234"
  const host =
    typeof window !== "undefined" ? window.location.hostname : "localhost"
  return `ws://${host}:${port}`
}

type CachedConn = {
  doc: Y.Doc
  provider: WebsocketProvider
  refs: number
  destroyTimer: ReturnType<typeof setTimeout> | null
}

type Snapshot = { conn: CachedConn | null; synced: boolean }

// A room's live connection is a mutable external resource shared across mounts,
// so it's modelled as an external store the provider reads via
// useSyncExternalStore. That's what lets a room prewarmed from the home screen
// be already synced on its first render — the sync gate never flashes — while
// keeping the create/teardown lifecycle out of render and out of effects.
const connections = new Map<string, CachedConn>()
const listeners = new Map<string, Set<() => void>>()
// Memoized per-room snapshot so getSnapshot stays referentially stable between
// unrelated renders (returning a fresh object every call would loop).
const snapshots = new Map<string, Snapshot>()
const SERVER_SNAPSHOT: Snapshot = { conn: null, synced: false }

// Long enough to bridge a StrictMode mount→unmount→remount, a quick
// back-and-forth navigation, or an abandoned prewarm (a room hovered but never
// opened); short enough to reclaim those promptly.
const TEARDOWN_GRACE_MS = 10_000

function notify(roomId: string): void {
  const entry = connections.get(roomId) ?? null
  const synced = entry?.provider.synced ?? false
  const prev = snapshots.get(roomId)
  if (prev && prev.conn === entry && prev.synced === synced) return
  snapshots.set(roomId, { conn: entry, synced })
  listeners.get(roomId)?.forEach((l) => l())
}

function getSnapshot(roomId: string): Snapshot {
  let snap = snapshots.get(roomId)
  if (!snap) {
    const entry = connections.get(roomId) ?? null
    snap = { conn: entry, synced: entry?.provider.synced ?? false }
    snapshots.set(roomId, snap)
  }
  return snap
}

function getOrCreate(roomId: string): CachedConn {
  let conn = connections.get(roomId)
  if (!conn) {
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(websocketUrl(), roomId, doc)
    const created: CachedConn = { doc, provider, refs: 0, destroyTimer: null }
    provider.on("sync", (isSynced: boolean) => {
      if (isSynced) notify(roomId)
    })
    connections.set(roomId, created)
    conn = created
  }
  if (conn.destroyTimer) {
    clearTimeout(conn.destroyTimer)
    conn.destroyTimer = null
  }
  return conn
}

function scheduleTeardown(roomId: string, conn: CachedConn): void {
  if (conn.destroyTimer) clearTimeout(conn.destroyTimer)
  conn.destroyTimer = setTimeout(() => {
    if (conn.refs > 0) return
    conn.provider.destroy()
    conn.doc.destroy()
    connections.delete(roomId)
    notify(roomId)
  }, TEARDOWN_GRACE_MS)
}

/**
 * Open (or reuse) a room's connection ahead of navigation so its initial sync
 * is already done by the time the route mounts — the difference between the
 * canvas appearing on the first frame and a one-frame flash of the sync-gate
 * fallback. Safe to call repeatedly (e.g. on every pointer-enter); an
 * un-mounted prewarm is torn down after the grace period.
 */
export function prewarmRoom(roomId: string): void {
  if (typeof window === "undefined") return
  const conn = getOrCreate(roomId)
  if (conn.refs === 0) scheduleTeardown(roomId, conn)
  notify(roomId)
}

export function YjsRoomProvider({
  roomId,
  fallback,
  children,
}: {
  roomId: string
  fallback: ReactNode
  children: ReactNode
}) {
  // Acquire the connection on subscribe (commit phase, never in render) and
  // release it on unmount. getOrCreate dedupes, so a prewarmed socket is reused
  // rather than reopened.
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const entry = getOrCreate(roomId)
      entry.refs += 1
      let set = listeners.get(roomId)
      if (!set) {
        set = new Set()
        listeners.set(roomId, set)
      }
      set.add(onStoreChange)
      notify(roomId)
      return () => {
        set.delete(onStoreChange)
        entry.refs -= 1
        if (entry.refs <= 0) {
          entry.refs = 0
          scheduleTeardown(roomId, entry)
        }
      }
    },
    [roomId]
  )

  const { conn, synced } = useSyncExternalStore(
    subscribe,
    () => getSnapshot(roomId),
    () => SERVER_SNAPSHOT
  )

  const value = useMemo<YjsConnection | null>(
    () =>
      conn
        ? {
            doc: conn.doc,
            awareness: conn.provider.awareness as unknown as AwarenessLike,
            roomId,
          }
        : null,
    [conn, roomId]
  )

  if (!value || !synced) return <>{fallback}</>

  return <YjsConnectionProvider value={value}>{children}</YjsConnectionProvider>
}
