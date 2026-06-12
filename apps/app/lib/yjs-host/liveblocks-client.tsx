"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  ClientSideSuspense,
  LiveblocksProvider,
  RoomProvider,
  useRoom,
} from "@liveblocks/react/suspense"
import { getYjsProviderForRoom } from "@liveblocks/yjs"
import {
  YjsConnectionProvider,
  type AwarenessLike,
  type YjsConnection,
} from "@/lib/yjs/context"
import { withBasePath } from "@/lib/base-path"
import "@/liveblocks.config"

/**
 * Host-agnostic React surface. Wraps a single room: connect to the Yjs host,
 * wait for the initial sync, expose `{ doc, awareness }` via `useYjs()`. The
 * `fallback` renders both during transport handshake and the Yjs sync gate.
 *
 * Today this is implemented on top of @liveblocks/react + @liveblocks/yjs.
 * Adding another host (Hocuspocus, y-websocket, Durable Objects) is a swap
 * of the inner tree — `useYjs()` consumers don't change.
 */
export function YjsRoomProvider({
  roomId,
  fallback,
  children,
}: {
  roomId: string
  fallback: ReactNode
  children: ReactNode
}) {
  return (
    <LiveblocksProvider
      authEndpoint={withBasePath("/api/yjs/auth")}
      badgeLocation="bottom-left"
    >
      <RoomProvider id={roomId} initialPresence={{}} initialStorage={{}}>
        <ClientSideSuspense fallback={fallback}>
          <SyncGate roomId={roomId} fallback={fallback}>
            {children}
          </SyncGate>
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  )
}

/**
 * Gates render on the host's "initial sync" event. The Liveblocks Yjs
 * provider exposes `synced` (boolean) plus a `sync` event; we mirror that
 * into React state so the canvas doesn't briefly mount against an empty
 * Y.Doc and flash an empty state.
 */
function SyncGate({
  roomId,
  fallback,
  children,
}: {
  roomId: string
  fallback: ReactNode
  children: ReactNode
}) {
  const room = useRoom()

  const value = useMemo<YjsConnection>(() => {
    const provider = getYjsProviderForRoom(room)
    return {
      doc: provider.getYDoc(),
      awareness: provider.awareness as unknown as AwarenessLike,
      roomId,
    }
  }, [room, roomId])

  // Read the underlying provider's sync state via a side import — keep it
  // local to this file so the host detail doesn't leak into the context type.
  const provider = useMemo(() => getYjsProviderForRoom(room), [room])
  const [synced, setSynced] = useState(provider.synced)
  useEffect(() => {
    const onSync = (isSynced: boolean) => {
      if (isSynced) setSynced(true)
    }
    // Subscribe first, then feed the provider's current sync state through the
    // same callback path. Deferring the initial read to a microtask avoids a
    // bare synchronous setState in the effect body while still catching a
    // provider that was already synced before we subscribed (and won't fire a
    // fresh "sync" event). `cancelled` guards against the microtask running
    // after cleanup if the provider changes.
    let cancelled = false
    provider.on("sync", onSync)
    queueMicrotask(() => {
      if (!cancelled) onSync(provider.synced)
    })
    return () => {
      cancelled = true
      provider.off("sync", onSync)
    }
  }, [provider])

  if (!synced) return <>{fallback}</>

  return <YjsConnectionProvider value={value}>{children}</YjsConnectionProvider>
}
