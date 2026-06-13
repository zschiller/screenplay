import { describe, expect, it, vi } from "vitest"

import { DirtyFrameTracker } from "./dirty-frames"

describe("DirtyFrameTracker", () => {
  describe("dirty-marking fire conditions", () => {
    it("marks a frame dirty on first load (not-ready → ready)", () => {
      const tracker = new DirtyFrameTracker()
      // Booting: ready never reported yet → nothing to capture.
      expect(tracker.dirtySubset()).toEqual([])

      tracker.setReady("a", true)
      // First paint: now ready and dirty.
      expect(tracker.dirtySubset()).toEqual(["a"])
    })

    it("re-marks dirty on the reload after a route/branch change", () => {
      const tracker = new DirtyFrameTracker()
      tracker.setReady("a", true)
      tracker.clear(["a"]) // captured the first load
      expect(tracker.dirtySubset()).toEqual([])

      // A route/branch change reloads the iframe: ready drops, then returns.
      tracker.setReady("a", false)
      expect(tracker.dirtySubset()).toEqual([])
      tracker.setReady("a", true)
      expect(tracker.dirtySubset()).toEqual(["a"])
    })

    it("marks dirty on an in-place HMR update with no ready transition", () => {
      const tracker = new DirtyFrameTracker()
      tracker.setReady("a", true)
      tracker.clear(["a"])
      expect(tracker.dirtySubset()).toEqual([])

      // HMR repaints in place — the frame stays ready throughout.
      tracker.markDirty("a")
      expect(tracker.dirtySubset()).toEqual(["a"])
    })

    it("does not re-mark dirty on a redundant ready report", () => {
      const tracker = new DirtyFrameTracker()
      tracker.setReady("a", true)
      tracker.clear(["a"])
      // The bridge re-asserting ready (no intervening reload) is not a change.
      tracker.setReady("a", true)
      expect(tracker.dirtySubset()).toEqual([])
    })

    it("withholds a dirty-but-not-ready frame until it reports ready", () => {
      const tracker = new DirtyFrameTracker()
      // HMR fires while the frame is still booting — dirty, but not capturable.
      tracker.markDirty("a")
      expect(tracker.dirtySubset()).toEqual([])

      tracker.setReady("a", true)
      expect(tracker.dirtySubset()).toEqual(["a"])
    })
  })

  describe("subscribe", () => {
    it("notifies when a frame becomes ready-and-dirty, and on HMR while ready", () => {
      const tracker = new DirtyFrameTracker()
      const listener = vi.fn()
      tracker.subscribe(listener)

      tracker.setReady("a", true) // first load → capturable
      expect(listener).toHaveBeenCalledTimes(1)

      tracker.markDirty("a") // HMR while ready → capturable again
      expect(listener).toHaveBeenCalledTimes(2)
    })

    it("does not notify for a not-ready dirty mark or a redundant ready", () => {
      const tracker = new DirtyFrameTracker()
      const listener = vi.fn()
      tracker.subscribe(listener)

      tracker.markDirty("a") // dirty but still booting → no wake
      expect(listener).not.toHaveBeenCalled()

      tracker.setReady("a", true) // becomes capturable → one wake
      expect(listener).toHaveBeenCalledTimes(1)

      tracker.setReady("a", true) // redundant → no wake
      expect(listener).toHaveBeenCalledTimes(1)
    })

    it("stops notifying after unsubscribe", () => {
      const tracker = new DirtyFrameTracker()
      const listener = vi.fn()
      const unsubscribe = tracker.subscribe(listener)
      unsubscribe()
      tracker.setReady("a", true)
      expect(listener).not.toHaveBeenCalled()
    })
  })

  describe("clear", () => {
    it("clears dirty only for the captured ids", () => {
      const tracker = new DirtyFrameTracker()
      tracker.setReady("a", true)
      tracker.setReady("b", true)
      expect(tracker.dirtySubset().sort()).toEqual(["a", "b"])

      tracker.clear(["a"])
      expect(tracker.dirtySubset()).toEqual(["b"])
    })

    it("keeps ready state through a clear, so a later change re-marks dirty", () => {
      const tracker = new DirtyFrameTracker()
      tracker.setReady("a", true)
      tracker.clear(["a"])
      tracker.markDirty("a") // still ready, so this is immediately capturable
      expect(tracker.dirtySubset()).toEqual(["a"])
    })
  })

  describe("retain", () => {
    it("drops frames no longer on the canvas", () => {
      const tracker = new DirtyFrameTracker()
      tracker.setReady("a", true)
      tracker.setReady("b", true)

      tracker.retain(["a"]) // "b" was deleted
      expect(tracker.dirtySubset()).toEqual(["a"])

      // A re-added id with the same name starts fresh (not pre-dirtied).
      tracker.retain(new Set(["a", "b"]))
      expect(tracker.dirtySubset()).toEqual(["a"])
    })
  })
})
