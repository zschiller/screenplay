"use client"

import { useEffect } from "react"
import { useYjs } from "@/lib/yjs/context"
import { withBasePath } from "@/lib/base-path"
import { isLocalBuild } from "@/lib/local-mode"
import type { DirtyFrameTracker } from "@/lib/thumbnail/dirty-frames"
import {
  THUMBNAIL_CAPTURE_SETTLE_MS as CAPTURE_SETTLE_MS,
  THUMBNAIL_HEARTBEAT_INITIAL_DELAY_MS as INITIAL_DELAY_MS,
  THUMBNAIL_HEARTBEAT_MIN_REFRESH_GAP_MS as MIN_REFRESH_GAP_MS,
  THUMBNAIL_LAYOUT_DEBOUNCE_MS as LAYOUT_DEBOUNCE_MS,
} from "@/lib/thumbnail/cadence"

/**
 * Drives the per-Room thumbnail while the editor is open, on two independent
 * debounced lanes (#474) so the cheap work never waits on the expensive work:
 *
 * - **Layout lane.** Every Y.Doc update (a moved/resized/renamed/recolored
 *   frame) resets a short trailing debounce; when it goes quiet we POST
 *   `frameIds: []`, a layout-only rebuild that repositions the manifest's rects
 *   without opening a browser. A drag coalesces into one write, and the home
 *   grid's skeleton tracks edits almost live.
 * - **Capture lane.** The {@link DirtyFrameTracker} fires when a frame becomes
 *   ready+dirty — its content actually settled (first paint, a route/branch
 *   reload, or an HMR reconnect). That resets a settle debounce; when it goes
 *   quiet we read the dirty subset and POST it, screenshotting exactly the
 *   frames whose pixels changed, of a settled page rather than a mid-reload
 *   flash. The server route applies the capture cooldown to this lane only.
 *
 * On mount, if the room has no thumbnail yet (or always, on the cheap local
 * build), a backstop full capture fires after a short settle so a brand-new room
 * gets an image even if no ready transition is observed. On unmount we flush a
 * pending layout write (persist the latest arrangement) and, if a capture was
 * scheduled and it's been long enough since the last one, flush that too
 * (catches "edit then close tab").
 */
export function useThumbnailHeartbeat(
  roomId: string,
  hasThumbnail: boolean,
  tracker: DirtyFrameTracker
): void {
  const { doc } = useYjs()

  useEffect(() => {
    let layoutTimer: ReturnType<typeof setTimeout> | null = null
    let captureTimer: ReturnType<typeof setTimeout> | null = null
    let initialTimer: ReturnType<typeof setTimeout> | null = null
    let lastCapture = 0

    // POST the heartbeat. `frameIds` undefined → full-room capture (the backstop
    // fire); an array → the layout lane (empty: rebuild rects, no browser) or the
    // capture lane (non-empty: screenshot exactly those frames).
    function post(frameIds?: readonly string[]) {
      const body = frameIds ? JSON.stringify({ frameIds }) : undefined
      void fetch(withBasePath(`/api/thumbnail/${encodeURIComponent(roomId)}`), {
        method: "POST",
        keepalive: true,
        ...(body
          ? { headers: { "content-type": "application/json" }, body }
          : {}),
      }).catch(() => {})
    }

    // Capture lane: screenshot the frames that are ready+dirty right now. No-op
    // when nothing settled (the debounce can outlive its dirty frames if they
    // were already cleared). Clears dirty so the next round starts clean.
    function fireCapture() {
      captureTimer = null
      const subset = tracker.dirtySubset()
      if (subset.length === 0) return
      tracker.clear(subset)
      lastCapture = Date.now()
      post(subset)
    }

    // Layout lane: rebuild the manifest's rects from the current doc, no browser.
    function fireLayout() {
      layoutTimer = null
      post([])
    }

    function onDocUpdate() {
      if (layoutTimer) clearTimeout(layoutTimer)
      layoutTimer = setTimeout(fireLayout, LAYOUT_DEBOUNCE_MS)
    }

    function onContentSettling() {
      if (captureTimer) clearTimeout(captureTimer)
      captureTimer = setTimeout(fireCapture, CAPTURE_SETTLE_MS)
    }

    doc.on("update", onDocUpdate)
    const unsubscribe = tracker.subscribe(onContentSettling)

    // Locally, fire on every open, not just the first: captures are cheap (local
    // webview + local fs, deduped by the server cooldown), and it refreshes any
    // thumbnail that went stale while the room was closed — including rows
    // persisted before a restart (the blob URL scheme changed once; see
    // lib/blob/local-fs.ts).
    if (!hasThumbnail || isLocalBuild) {
      initialTimer = setTimeout(() => {
        initialTimer = null
        lastCapture = Date.now()
        post()
      }, INITIAL_DELAY_MS)
    }

    return () => {
      doc.off("update", onDocUpdate)
      unsubscribe()
      if (initialTimer) clearTimeout(initialTimer)

      // Flush a pending layout write so the latest arrangement is persisted even
      // if the tab closes mid-debounce — it's cheap and opens no browser.
      if (layoutTimer) {
        clearTimeout(layoutTimer)
        fireLayout()
      }

      // Flush a scheduled-but-unfired capture (edit then close), but only if it's
      // been long enough since the last one — mirrors the route's cooldown intent
      // client-side so closing the tab doesn't fire a capture we'd otherwise drop.
      if (captureTimer) {
        clearTimeout(captureTimer)
        if (Date.now() - lastCapture > MIN_REFRESH_GAP_MS) {
          const subset = tracker.dirtySubset()
          if (subset.length > 0) {
            tracker.clear(subset)
            post(subset)
          }
        }
      }
    }
  }, [doc, roomId, hasThumbnail, tracker])
}
