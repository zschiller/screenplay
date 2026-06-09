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
  const { doc, provider } = useMemo(() => {
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(websocketUrl(), roomId, doc)
    return { doc, provider }
  }, [roomId])

  useEffect(() => {
    return () => {
      provider.destroy()
      doc.destroy()
    }
  }, [doc, provider])

  // Gate render on the initial sync so the canvas doesn't mount against an
  // empty Y.Doc and flash an empty state — same contract as the Liveblocks
  // client's SyncGate.
  const [synced, setSynced] = useState(provider.synced)
  useEffect(() => {
    const onSync = (isSynced: boolean) => {
      if (isSynced) setSynced(true)
    }
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

  const value = useMemo<YjsConnection>(
    () => ({
      doc,
      awareness: provider.awareness as unknown as AwarenessLike,
    }),
    [doc, provider]
  )

  if (!synced) return <>{fallback}</>

  return <YjsConnectionProvider value={value}>{children}</YjsConnectionProvider>
}
