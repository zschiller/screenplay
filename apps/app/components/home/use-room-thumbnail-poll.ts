"use client"

import { useEffect, type Dispatch, type SetStateAction } from "react"
import { listRoomThumbnails, type RoomSummary } from "@/lib/rooms-actions"
import { mergeRoomThumbnails } from "@/lib/room-thumbnail-merge"
import { isLocalBuild } from "@/lib/local-mode"

// How often an open grid re-reads the per-Room thumbnail record. Captures land
// roughly as fast as the editor's heartbeat fires (use-thumbnail-heartbeat.ts),
// so the desktop build — whose local-webview + local-fs captures run much
// hotter — polls faster for a snappier refresh than the hosted build.
const POLL_MS = isLocalBuild ? 5_000 : 20_000

/**
 * Keeps the homescreen grid's thumbnails fresh without a full page reload: while
 * the tab is visible, it polls {@link listRoomThumbnails} (a cheap per-Room
 * record read — manifest + capture time, never a Room's Y.Doc) and merges any
 * newer capture into the loaded summaries via {@link mergeRoomThumbnails}. The
 * merge touches only thumbnail fields and preserves array identity when nothing
 * is newer, so ordering, name edits, and unchanged cards are left alone.
 *
 * Polling pauses when the tab is hidden and fires once immediately on regaining
 * visibility, so a grid left open in a background tab catches up at once on
 * return rather than waiting out a full interval.
 */
export function useRoomThumbnailPoll(
  enabled: boolean,
  setRooms: Dispatch<SetStateAction<RoomSummary[]>>
): void {
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    async function poll() {
      try {
        const thumbnails = await listRoomThumbnails()
        if (!cancelled) {
          setRooms((prev) => mergeRoomThumbnails(prev, thumbnails))
        }
      } catch {
        // Best-effort: a failed poll just waits for the next tick.
      }
    }

    function start() {
      if (timer) return
      timer = setInterval(() => void poll(), POLL_MS)
    }

    function stop() {
      if (timer) {
        clearInterval(timer)
        timer = null
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        // Grid is already seeded on mount, so only poll-on-show — catching up
        // whatever captured while the tab was backgrounded — then resume.
        void poll()
        start()
      } else {
        stop()
      }
    }

    // Poll once immediately on mount, not just on the interval: navigating back
    // to home from a room re-seeds the grid from a server render that races the
    // editor's layout write (it lands in the route's `after()`), so the seed is
    // usually a beat stale. An immediate poll picks up the just-saved layout at
    // once instead of leaving the old arrangement on screen for a full interval.
    if (document.visibilityState === "visible") {
      void poll()
      start()
    }
    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      cancelled = true
      stop()
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [enabled, setRooms])
}
