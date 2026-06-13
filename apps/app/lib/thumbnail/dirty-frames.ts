/**
 * Per-frame dirty/ready bookkeeping for the coalesced thumbnail heartbeat (#474).
 *
 * The heartbeat used to recapture the whole Room on every fire. This tracker
 * bounds that cost: each Iframe Layer reports its own ready/dirty transitions
 * here, and the heartbeat POSTs only the *dirty subset* — the frames that
 * actually changed since the last capture — so a fire screenshots the changed
 * frames instead of all of them. Frames left out of the subset keep their prior
 * capture through the manifest's retain-last-good merge (#470).
 *
 * "Dirty" is set on the conditions that change a frame's pixels:
 * - **First load / reload.** A frame transitioning from not-ready to ready —
 *   the initial paint, and the re-paint after a route or branch change reloads
 *   it (the reload drops `ready`, the bridge then reports `ready` again). Both
 *   funnel through {@link DirtyFrameTracker.setReady}.
 * - **HMR update.** A hot-module swap repaints in place with no `ready`
 *   transition, so the Iframe Layer marks it dirty explicitly through
 *   {@link DirtyFrameTracker.markDirty}.
 *
 * A frame is only *captured* once it is both ready and dirty — a frame that's
 * dirty but still booting waits until it reports ready, so the heartbeat never
 * ships a not-ready frame into the capture round. Dirty is cleared the moment
 * the frame is included in a POSTed subset (the fire that triggers its
 * recapture).
 *
 * Framework-free and synchronous so it's exercised with plain fixtures; the
 * React glue (the heartbeat hook + the Iframe Layer wiring) is a thin consumer.
 */
export type FrameCaptureState = { ready: boolean; dirty: boolean }

export class DirtyFrameTracker {
  private readonly frames = new Map<string, FrameCaptureState>()
  private readonly listeners = new Set<() => void>()

  /**
   * Subscribe to "a frame just became capturable" (ready && dirty). The
   * heartbeat schedules a throttled fire off this so the dirty conditions that
   * aren't already Y.Doc updates — first load and HMR — still wake it. Returns
   * an unsubscribe.
   */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  /**
   * Record a frame's readiness. A not-ready → ready transition marks the frame
   * dirty: that single transition covers both first load and the reload that
   * follows a route or branch change (which drops `ready` first). Redundant
   * `setReady(id, true)` calls on an already-ready frame are no-ops.
   */
  setReady(id: string, ready: boolean): void {
    const prev = this.frames.get(id)
    const becameReady = ready && !(prev?.ready ?? false)
    const dirty = (prev?.dirty ?? false) || becameReady
    this.frames.set(id, { ready, dirty })
    // Only a fresh ready-and-dirty frame is worth waking the heartbeat for; a
    // mere ready→not-ready drop (a reload starting) waits for the next ready.
    if (becameReady) this.notify()
  }

  /**
   * Mark a frame dirty without a ready transition — the HMR-update path, where
   * the preview repaints in place. Wakes the heartbeat only if the frame is
   * already ready (otherwise the eventual `setReady` does, once it's capturable).
   */
  markDirty(id: string): void {
    const prev = this.frames.get(id)
    const ready = prev?.ready ?? false
    this.frames.set(id, { ready, dirty: true })
    if (ready) this.notify()
  }

  /**
   * Drop tracked frames no longer present in `ids` (deleted from the canvas), so
   * a stale id never lands in a POSTed subset for a frame the capture round
   * can't find.
   */
  retain(ids: Iterable<string>): void {
    const keep = ids instanceof Set ? ids : new Set(ids)
    for (const id of this.frames.keys()) {
      if (!keep.has(id)) this.frames.delete(id)
    }
  }

  /** The capture subset: every frame that is both ready and dirty. */
  dirtySubset(): string[] {
    const subset: string[] = []
    for (const [id, state] of this.frames) {
      if (state.ready && state.dirty) subset.push(id)
    }
    return subset
  }

  /** Clear dirty for the given ids — called once they've been POSTed for capture. */
  clear(ids: Iterable<string>): void {
    for (const id of ids) {
      const state = this.frames.get(id)
      if (state) this.frames.set(id, { ready: state.ready, dirty: false })
    }
  }
}
