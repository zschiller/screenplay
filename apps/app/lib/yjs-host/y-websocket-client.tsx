"use client"

import { useEffect, useMemo, useState, type ReactNode } from "react"
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

export function YjsRoomProvider({
  roomId,
  fallback,
  children,
}: {
  roomId: string
  fallback: ReactNode
  children: ReactNode
}) {
  // The provider is created (and torn down) by the effect, NOT in a useMemo:
  // dev StrictMode mounts → unmounts → remounts, and a memoized provider
  // destroyed by the first cleanup would be reused dead on the remount — the
  // socket closes mid-connect and the sync gate below never opens. An
  // effect-owned provider is recreated fresh on every (re)mount.
  const [conn, setConn] = useState<{
    doc: Y.Doc
    provider: WebsocketProvider
  } | null>(null)

  // Gate render on the initial sync so the canvas doesn't mount against an
  // empty Y.Doc and flash an empty state — same contract as the Liveblocks
  // client's SyncGate.
  const [synced, setSynced] = useState(false)

  useEffect(() => {
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(websocketUrl(), roomId, doc)
    const onSync = (isSynced: boolean) => {
      if (isSynced) setSynced(true)
    }
    provider.on("sync", onSync)
    setConn({ doc, provider })
    return () => {
      provider.off("sync", onSync)
      provider.destroy()
      doc.destroy()
      setConn(null)
      setSynced(false)
    }
  }, [roomId])

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
