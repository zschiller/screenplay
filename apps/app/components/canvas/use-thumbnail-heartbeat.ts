"use client"

import { useEffect } from "react"
import { useYjs } from "@/lib/yjs/context"
import { withBasePath } from "@/lib/base-path"
import { isLocalBuild } from "@/lib/local-mode"
import type { DirtyFrameTracker } from "@/lib/thumbnail/dirty-frames"
import {
  THUMBNAIL_HEARTBEAT_INITIAL_DELAY_MS as INITIAL_DELAY_MS,
  THUMBNAIL_HEARTBEAT_MIN_REFRESH_GAP_MS as MIN_REFRESH_GAP_MS,
  THUMBNAIL_HEARTBEAT_PERIOD_MS as PERIOD_MS,
} from "@/lib/thumbnail/cadence"

/**
 * Periodically POSTs to /api/thumbnail/[roomId] while the editor is open,
 * carrying only the **dirty subset** of frames to recapture (#474).
 *
 * Trigger shape (throttle, not debounce):
 * - The first wake schedules a fire `PERIOD_MS` out. Subsequent wakes inside
 *   that window do NOT reset the timer — they piggy-back on the already-
 *   scheduled fire, so every change coalesced into the window ships together.
 *   After firing, the next wake opens a fresh window. Net: at most one fire per
 *   `PERIOD_MS` of activity.
 * - Two things wake the heartbeat: Y.Doc updates (a moved/resized/renamed frame
 *   — layout, not pixels) and the {@link DirtyFrameTracker} (first load, route/
 *   branch change, HMR — a frame's content actually changed).
 * - At fire time we read the tracker's dirty subset and POST it. A non-empty
 *   subset recaptures exactly those frames; an empty subset still POSTs
 *   (`frameIds: []`) so the server rebuilds the manifest's layout — repositioning
 *   a moved frame — without opening a browser. The posted frames are cleared so
 *   the next round starts from a clean slate.
 * - On mount, if the room has no thumbnail yet, fire once with no subset (a full
 *   capture of every ready frame) after a short settle so iframes can load.
 * - On unmount, flush a scheduled-but-unfired window (catches "edit then close
 *   tab"). Skipped if we just fired.
 *
 * The server route applies its own cooldown, which deduplicates any overlap
 * between the initial fire and the throttled fire.
 */
export function useThumbnailHeartbeat(
  roomId: string,
  hasThumbnail: boolean,
  tracker: DirtyFrameTracker
): void {
  const { doc } = useYjs()

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let initialTimer: ReturnType<typeof setTimeout> | null = null
    let lastFire = 0

    // POST the heartbeat. `frameIds` undefined → full-room capture (the initial
    // fire); an array (possibly empty) → the dirty subset to recapture, with an
    // empty array meaning "rebuild the manifest layout, capture nothing".
    function post(frameIds?: readonly string[]) {
      lastFire = Date.now()
      const body = frameIds ? JSON.stringify({ frameIds }) : undefined
      void fetch(withBasePath(`/api/thumbnail/${encodeURIComponent(roomId)}`), {
        method: "POST",
        keepalive: true,
        ...(body
          ? { headers: { "content-type": "application/json" }, body }
          : {}),
      }).catch(() => {})
    }

    function fire() {
      timer = null
      const subset = tracker.dirtySubset()
      tracker.clear(subset)
      post(subset)
    }

    function ensureScheduled() {
      if (timer) return
      timer = setTimeout(fire, PERIOD_MS)
    }

    doc.on("update", ensureScheduled)
    const unsubscribe = tracker.subscribe(ensureScheduled)

    // Locally, fire on every open, not just the first: captures are cheap
    // (local webview + local fs, deduped by the server cooldown), and it
    // refreshes any thumbnail that went stale while the room was closed —
    // including rows persisted before a restart (the blob URL scheme changed
    // once; see lib/blob/local-fs.ts).
    if (!hasThumbnail || isLocalBuild) {
      initialTimer = setTimeout(() => {
        initialTimer = null
        post()
      }, INITIAL_DELAY_MS)
    }

    return () => {
      doc.off("update", ensureScheduled)
      unsubscribe()
      if (initialTimer) clearTimeout(initialTimer)
      const hadPending = timer !== null
      if (timer) clearTimeout(timer)
      if (hadPending && Date.now() - lastFire > MIN_REFRESH_GAP_MS) {
        const subset = tracker.dirtySubset()
        tracker.clear(subset)
        post(subset)
      }
    }
  }, [doc, roomId, hasThumbnail, tracker])
}
