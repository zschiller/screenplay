import { useCallback, useEffect, useRef, useState } from "react"

import type {
  FrameStreamConnection,
  GoLiveFailure,
} from "@/lib/frame-stream/client"
import type { BranchData } from "@/lib/types"

const EMPTY: ReadonlySet<string> = new Set()

/** What the toast says when going live fails, as a plain sentence. */
export const GO_LIVE_FAILED: Record<
  GoLiveFailure | "not-running" | "dev-server-stopped",
  string
> = {
  "not-running": "Couldn’t go live because the workspace isn’t running.",
  "dev-server-stopped":
    "Couldn’t go live because the workspace’s dev server is stopped.",
  unreachable: "Couldn’t go live because the workspace didn’t answer.",
  failed: "Couldn’t go live because the frame’s browser didn’t start.",
  timeout: "Couldn’t go live because the frame took too long to start.",
}

export type GoLive = {
  /** This viewer turned the frame live and waits for its first picture. */
  pendingIds: ReadonlySet<string>
  /**
   * The Go live toggle's click: turn the frame live, or end it. Ignored while
   * this viewer's own going live is pending, so a double click doesn't go
   * live and straight back out.
   */
  toggle(frame: {
    id: string
    live: boolean
    stream: FrameStreamConnection
    workspace: Pick<BranchData, "status" | "devServerStoppedAt"> | undefined
  }): void
}

/**
 * Going live, as the viewer who clicks sees it (#1520): from the click until
 * the first picture arrives the frame is pending (the toggle spins in place
 * of its icon), and if it fails the frame goes back off, for everyone, since
 * nobody can see it, and `onFailed` says why. A Workspace that isn't running
 * fails at once, without going live.
 *
 * Ending live is instant; someone else ending it while it's pending drops
 * the wait without a word.
 */
export function useGoLive({
  setLive,
  onFailed,
  liveIds,
}: {
  /** Turn the frame live, or back off, for everyone (its synced flag). */
  setLive: (id: string, live: boolean) => void
  onFailed: (message: string) => void
  /** The frames that are live now. */
  liveIds: ReadonlySet<string>
}): GoLive {
  const [pendingIds, setPendingIds] = useState<ReadonlySet<string>>(EMPTY)
  // Read and written in the click itself, so a second click before the
  // re-render is ignored too.
  const pendingRef = useRef(pendingIds)
  // Each going live of a frame, so a stale wait never settles a newer one.
  const runs = useRef(new Map<string, number>())
  const latest = useRef({ setLive, onFailed })
  useEffect(() => {
    latest.current = { setLive, onFailed }
  })

  const settle = useCallback((id: string) => {
    if (!pendingRef.current.has(id)) return false
    const next = new Set(pendingRef.current)
    next.delete(id)
    pendingRef.current = next
    setPendingIds(next)
    return true
  }, [])

  // Someone else ended it while it started: nothing left to wait for. The
  // flag reaches `liveIds` a render after the click, so only a frame seen
  // live counts as ended.
  const seenLive = useRef(new Set<string>())
  useEffect(() => {
    for (const id of seenLive.current)
      if (!pendingIds.has(id)) seenLive.current.delete(id)
    for (const id of pendingIds) {
      if (liveIds.has(id)) seenLive.current.add(id)
      else if (seenLive.current.has(id)) settle(id)
    }
  }, [pendingIds, liveIds, settle])

  const toggle = useCallback<GoLive["toggle"]>(
    ({ id, live, stream, workspace }) => {
      if (pendingRef.current.has(id)) return
      if (live) {
        latest.current.setLive(id, false)
        return
      }
      const refusal =
        workspace && workspace.status !== "running"
          ? "not-running"
          : workspace?.devServerStoppedAt
            ? "dev-server-stopped"
            : null
      if (refusal) {
        latest.current.onFailed(GO_LIVE_FAILED[refusal])
        return
      }
      pendingRef.current = new Set([...pendingRef.current, id])
      setPendingIds(pendingRef.current)
      const run = (runs.current.get(id) ?? 0) + 1
      runs.current.set(id, run)
      latest.current.setLive(id, true)
      void stream
        .frame(id)
        .firstPicture()
        .then((failure) => {
          // A later going live of the same frame waits for itself.
          if (runs.current.get(id) !== run) return
          if (!settle(id) || !failure) return
          latest.current.setLive(id, false)
          latest.current.onFailed(GO_LIVE_FAILED[failure])
        })
    },
    [settle]
  )

  return { pendingIds, toggle }
}
