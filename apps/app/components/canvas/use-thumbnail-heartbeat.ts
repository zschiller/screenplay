"use client"

import { useEffect, useMemo, useRef } from "react"
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
 *
 * Returns {@link flushLayout}: an awaitable that POSTs any pending layout edit
 * and resolves once the server has rebuilt the manifest. A deliberate navigation
 * away (the breadcrumb back, a full-page `window.location.assign`) awaits it so
 * the home grid it lands on renders the just-saved arrangement — the React
 * unmount cleanup below does NOT run on a full-page unload, so without this the
 * last edit would never reach the server. A `pagehide` listener covers the
 * fire-and-forget unloads (tab close, bfcache) the same way.
 */
export function useThumbnailHeartbeat(
  roomId: string,
  hasThumbnail: boolean,
  tracker: DirtyFrameTracker
): { flushLayout: () => Promise<void> } {
  const { doc } = useYjs()
  // Holds the live effect's flush so the stable callback returned below always
  // calls the current room's implementation; reset to a no-op on unmount.
  const flushRef = useRef<() => Promise<void>>(() => Promise.resolve())

  useEffect(() => {
    let layoutTimer: ReturnType<typeof setTimeout> | null = null
    let captureTimer: ReturnType<typeof setTimeout> | null = null
    let initialTimer: ReturnType<typeof setTimeout> | null = null
    let lastCapture = 0
    // The most recent layout-lane POST, so `flushLayout` can await an already
    // fired-but-in-flight rebuild (not just one still sitting on the debounce).
    let pendingLayoutPost: Promise<unknown> | null = null

    // POST the heartbeat. `frameIds` undefined → full-room capture (the backstop
    // fire); an array → the layout lane (empty: rebuild rects, no browser) or the
    // capture lane (non-empty: screenshot exactly those frames). Returns the
    // fetch so the layout lane can be awaited.
    function post(frameIds?: readonly string[]) {
      const body = frameIds ? JSON.stringify({ frameIds }) : undefined
      return fetch(
        withBasePath(`/api/thumbnail/${encodeURIComponent(roomId)}`),
        {
          method: "POST",
          keepalive: true,
          ...(body
            ? { headers: { "content-type": "application/json" }, body }
            : {}),
        }
      ).catch(() => {})
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
      pendingLayoutPost = post([])
      return pendingLayoutPost
    }

    // Send any pending layout edit and resolve once the rebuild lands. Fires a
    // still-debounced edit immediately, then awaits the latest layout POST (the
    // route rebuilds the layout lane inline, so a resolved POST means a persisted
    // manifest). A no-op fast path when nothing's outstanding.
    async function flushLayout() {
      if (layoutTimer) {
        clearTimeout(layoutTimer)
        fireLayout()
      }
      await pendingLayoutPost
    }
    flushRef.current = flushLayout

    function onDocUpdate() {
      if (layoutTimer) clearTimeout(layoutTimer)
      layoutTimer = setTimeout(fireLayout, LAYOUT_DEBOUNCE_MS)
    }

    function onContentSettling() {
      if (captureTimer) clearTimeout(captureTimer)
      captureTimer = setTimeout(fireCapture, CAPTURE_SETTLE_MS)
    }

    // A full-page unload (the breadcrumb's `window.location.assign`, a tab close,
    // or eviction into bfcache) tears the page down WITHOUT running the React
    // unmount cleanup below, so the pending-layout flush there would be skipped
    // and the last edit lost. `pagehide` fires in all of those; flush there too,
    // relying on the POST's `keepalive` so it survives the unload. (The deliberate
    // breadcrumb path also awaits `flushLayout` for an instant fresh landing; this
    // is the fire-and-forget backstop for everything else.)
    function onPageHide() {
      if (layoutTimer) {
        clearTimeout(layoutTimer)
        fireLayout()
      }
    }

    // Layout lane is CLIENT-driven only on the hosted build. On the local build
    // the sidecar holds the authoritative doc and rebuilds the layout manifest
    // itself (`watchLocalRoomLayout`), so skipping the client lane here avoids a
    // redundant rebuild — and means the fragile flush-on-navigate paths below
    // (pagehide, unmount, `flushLayout`) are inert locally, with `layoutTimer`
    // never set. The capture lane stays client-driven on both backends.
    if (!isLocalBuild) doc.on("update", onDocUpdate)
    const unsubscribe = tracker.subscribe(onContentSettling)
    window.addEventListener("pagehide", onPageHide)

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
      window.removeEventListener("pagehide", onPageHide)
      flushRef.current = () => Promise.resolve()
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

  // Stable handle that defers to whichever effect run is live (or a no-op once
  // unmounted), so callers can hold it across renders.
  return useMemo(
    () => ({ flushLayout: () => flushRef.current() }),
    []
  )
}
