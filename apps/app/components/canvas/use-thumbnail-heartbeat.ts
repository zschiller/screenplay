"use client"

import { useEffect } from "react"
import { useYjs } from "@/lib/yjs/context"
import { withBasePath } from "@/lib/base-path"
import { isLocalBuild } from "@/lib/local-mode"

// The hosted cadence is priced for a headless-Chromium capture on a paid
// function per fire; the desktop capture is a local webview and a local file
// write, so it can run much hotter. Must stay above the server route's
// cooldown or every throttled fire lands inside it and gets skipped.
const PERIOD_MS = isLocalBuild ? 8_000 : 30_000
const INITIAL_DELAY_MS = 3_000
const MIN_REFRESH_GAP_MS = 5_000

/**
 * Periodically POSTs to /api/thumbnail/[roomId] while the editor is open.
 *
 * Trigger shape (throttle, not debounce):
 * - First Yjs update schedules a fire `PERIOD_MS` out. Subsequent updates
 *   inside that window do NOT reset the timer — they piggy-back on the
 *   already-scheduled fire. After firing, the next update opens a fresh
 *   window. Net: at most one fire per `PERIOD_MS` of activity.
 * - On mount, if the room has no thumbnail yet, fire once after a short
 *   settle so iframes have time to load.
 * - On unmount, fire once if there are unsaved changes since the last fire
 *   (catches "edit then close tab"). Skipped if we just fired.
 *
 * The server route applies a 25s cooldown of its own, which deduplicates
 * any overlap between the initial fire and the throttled fire.
 */
export function useThumbnailHeartbeat(
  roomId: string,
  hasThumbnail: boolean
): void {
  const { doc } = useYjs()

  useEffect(() => {
    let dirty = false
    let timer: ReturnType<typeof setTimeout> | null = null
    let initialTimer: ReturnType<typeof setTimeout> | null = null
    let lastFire = 0

    function send() {
      lastFire = Date.now()
      void fetch(withBasePath(`/api/thumbnail/${encodeURIComponent(roomId)}`), {
        method: "POST",
        keepalive: true,
      }).catch(() => {})
    }

    function fire() {
      timer = null
      dirty = false
      send()
    }

    function ensureScheduled() {
      if (timer) return
      timer = setTimeout(fire, PERIOD_MS)
    }

    function onUpdate() {
      dirty = true
      ensureScheduled()
    }

    doc.on("update", onUpdate)

    // Locally, fire on every open, not just the first: captures are cheap
    // (local webview + local fs, deduped by the server cooldown), and it
    // refreshes any thumbnail that went stale while the room was closed —
    // including rows persisted before a restart (the blob URL scheme changed
    // once; see lib/blob/local-fs.ts).
    if (!hasThumbnail || isLocalBuild) {
      initialTimer = setTimeout(() => {
        initialTimer = null
        send()
      }, INITIAL_DELAY_MS)
    }

    return () => {
      doc.off("update", onUpdate)
      if (timer) clearTimeout(timer)
      if (initialTimer) clearTimeout(initialTimer)
      if (dirty && Date.now() - lastFire > MIN_REFRESH_GAP_MS) {
        send()
      }
    }
  }, [doc, roomId, hasThumbnail])
}
