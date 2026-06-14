import "server-only"

import type * as Y from "yjs"
import { getRoomCollections } from "@/lib/yjs/schema"
import { rebuildRoomLayoutThumbnail } from "./rebuild-layout"
import { THUMBNAIL_LAYOUT_DEBOUNCE_MS as DEBOUNCE_MS } from "./cadence"

/**
 * Keeps a Room's thumbnail *layout* (the manifest's rects/labels) fresh
 * server-side on the local host, where the sidecar holds the authoritative Y.Doc
 * in-process (`y-websocket-server.ts`). Every canvas edit the webview makes
 * arrives over the WebSocket and lands in that doc, so the server can rebuild the
 * manifest the moment the layout changes — no client heartbeat, no flush-on-
 * navigate, no race against page unload. This is the fix for thumbnails going
 * stale when you edit a Canvas and return home: freshness no longer depends on
 * the editor surviving long enough to POST its last edit.
 *
 * It watches only the layout collections (frames, groups, markdown, branches) —
 * NOT chat/stream maps — so a chat token stream doesn't thrash a rebuild. A
 * trailing debounce coalesces a drag into one rebuild. The rebuild is the cheap
 * lane (`frameIds: []`): a doc read + a manifest write, no browser, and it leaves
 * the capture clock untouched so it never starves the capture cooldown. Frame
 * *captures* (the expensive screenshots) stay client-driven via the heartbeat's
 * capture lane — the server can't know when an iframe's content has settled.
 *
 * Returns a detach function; it also self-detaches when the doc is destroyed
 * (y-websocket destroys a room's doc on the last disconnect), so a reconnect
 * gets a fresh watcher rather than stacking observers.
 */
export function watchLocalRoomLayout(roomId: string, doc: Y.Doc): () => void {
  const c = getRoomCollections(doc)
  let timer: ReturnType<typeof setTimeout> | null = null
  let detached = false

  function rebuild() {
    timer = null
    void rebuildRoomLayoutThumbnail(roomId).catch((err) => {
      console.warn(`[thumbnail] local layout rebuild failed (${roomId})`, err)
    })
  }

  function onChange() {
    if (detached) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(rebuild, DEBOUNCE_MS)
    // A pending rebuild must never keep the sidecar process alive on its own.
    timer.unref?.()
  }

  const unsubscribes = [
    c.iframeLayers.observe(onChange),
    c.iframeLayerGroups.observe(onChange),
    c.markdownLayers.observe(onChange),
    c.branches.observe(onChange),
  ]

  function detach() {
    if (detached) return
    detached = true
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    for (const off of unsubscribes) off()
    doc.off("destroy", detach)
  }

  doc.on("destroy", detach)
  return detach
}
