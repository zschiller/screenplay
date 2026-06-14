// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DirtyFrameTracker } from "@/lib/thumbnail/dirty-frames"

// A fake Y.Doc that just lets the test emit "update" events the hook subscribes
// to — the heartbeat only ever calls `doc.on`/`doc.off("update", …)`.
const { doc, emitUpdate } = vi.hoisted(() => {
  const handlers = new Set<() => void>()
  return {
    doc: {
      on: (_event: string, handler: () => void) => handlers.add(handler),
      off: (_event: string, handler: () => void) => handlers.delete(handler),
    },
    emitUpdate: () => {
      for (const handler of handlers) handler()
    },
  }
})

vi.mock("@/lib/yjs/context", () => ({ useYjs: () => ({ doc }) }))
// Force the hosted cadence and keep the backstop mount fire off the
// `isLocalBuild` path so tests opt into it via `hasThumbnail`.
vi.mock("@/lib/local-mode", () => ({ isLocalBuild: false }))

import { useThumbnailHeartbeat } from "./use-thumbnail-heartbeat"

// Hosted bounds (see cadence.ts).
const SETTLE_MS = 1_500
const LAYOUT_DEBOUNCE_MS = 500
const INITIAL_DELAY_MS = 3_000
const MIN_REFRESH_GAP_MS = 3_000
const URL = "/api/thumbnail/room-1"

/** Parsed body of one fetch call, or `undefined` when none was sent. */
function bodyOf(call: unknown[] | undefined): unknown {
  const init = call?.[1] as RequestInit | undefined
  return init?.body ? JSON.parse(init.body as string) : undefined
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(1_700_000_000_000)
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })))
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  // Unmount any mounted hook so its doc-update subscription is torn down — the
  // fake doc's handler set is shared across tests, so a lingering hook would
  // fire on the next test's emitUpdate.
  cleanup()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe("useThumbnailHeartbeat", () => {
  describe("capture lane", () => {
    it("coalesces frames that settle together into one post-settle capture", () => {
      const tracker = new DirtyFrameTracker()
      renderHook(() => useThumbnailHeartbeat("room-1", true, tracker))

      // Two frames settle within the same window — one capture carries both.
      act(() => {
        tracker.setReady("a", true)
        tracker.setReady("b", true)
      })
      expect(fetchMock).not.toHaveBeenCalled()

      act(() => vi.advanceTimersByTime(SETTLE_MS))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]!
      expect(url).toBe(URL)
      expect((init as RequestInit).method).toBe("POST")
      expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ frameIds: ["a", "b"] })
    })

    it("debounces: a fresh settle signal resets the window", () => {
      const tracker = new DirtyFrameTracker()
      renderHook(() => useThumbnailHeartbeat("room-1", true, tracker))

      act(() => tracker.setReady("a", true))
      act(() => {
        vi.advanceTimersByTime(SETTLE_MS - 1)
        tracker.markDirty("a") // ready+dirty → resets the settle timer
      })
      // The first window would have fired here had it not been reset.
      act(() => vi.advanceTimersByTime(SETTLE_MS - 1))
      expect(fetchMock).not.toHaveBeenCalled()

      act(() => vi.advanceTimersByTime(1))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ frameIds: ["a"] })
    })

    it("does not capture a frame that is dirty but never reports ready", () => {
      const tracker = new DirtyFrameTracker()
      renderHook(() => useThumbnailHeartbeat("room-1", true, tracker))

      // Dirty but still booting: not in the subset, so the settle window opened
      // by a *different* frame captures nothing for it.
      act(() => {
        tracker.markDirty("a") // a is not ready → no notify, no timer
        tracker.setReady("b", true) // b settles → window opens
        vi.advanceTimersByTime(SETTLE_MS)
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ frameIds: ["b"] })
    })
  })

  describe("layout lane", () => {
    it("posts an empty subset shortly after a layout-only Y.Doc update", () => {
      const tracker = new DirtyFrameTracker()
      renderHook(() => useThumbnailHeartbeat("room-1", true, tracker))

      // A move/resize/rename is a doc update with no frame dirty.
      act(() => {
        emitUpdate()
        vi.advanceTimersByTime(LAYOUT_DEBOUNCE_MS)
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ frameIds: [] })
    })

    it("coalesces a burst of doc updates into one layout write", () => {
      const tracker = new DirtyFrameTracker()
      renderHook(() => useThumbnailHeartbeat("room-1", true, tracker))

      act(() => {
        emitUpdate()
        vi.advanceTimersByTime(LAYOUT_DEBOUNCE_MS - 1)
        emitUpdate() // resets the debounce
        vi.advanceTimersByTime(LAYOUT_DEBOUNCE_MS - 1)
      })
      expect(fetchMock).not.toHaveBeenCalled()

      act(() => vi.advanceTimersByTime(1))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ frameIds: [] })
    })
  })

  describe("backstop + unmount", () => {
    it("fires a full capture (no body) on mount when the room has no thumbnail", () => {
      const tracker = new DirtyFrameTracker()
      renderHook(() => useThumbnailHeartbeat("room-1", false, tracker))

      act(() => vi.advanceTimersByTime(INITIAL_DELAY_MS))
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const init = fetchMock.mock.calls[0]![1] as RequestInit
      expect(init.method).toBe("POST")
      expect(init.body).toBeUndefined()
    })

    it("flushes a pending layout write on unmount", () => {
      const tracker = new DirtyFrameTracker()
      const { unmount } = renderHook(() =>
        useThumbnailHeartbeat("room-1", true, tracker)
      )

      act(() => {
        emitUpdate()
        vi.advanceTimersByTime(LAYOUT_DEBOUNCE_MS / 2) // close mid-debounce
      })
      expect(fetchMock).not.toHaveBeenCalled()

      act(() => unmount())
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ frameIds: [] })
    })

    it("flushes a scheduled-but-unfired capture on unmount (edit then close)", () => {
      const tracker = new DirtyFrameTracker()
      const { unmount } = renderHook(() =>
        useThumbnailHeartbeat("room-1", true, tracker)
      )

      act(() => {
        tracker.setReady("a", true)
        vi.advanceTimersByTime(SETTLE_MS / 2) // close before the capture lands
      })
      expect(fetchMock).not.toHaveBeenCalled()

      act(() => unmount())
      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ frameIds: ["a"] })
    })

    it("does not flush a capture on unmount right after one fired", () => {
      const tracker = new DirtyFrameTracker()
      const { unmount } = renderHook(() =>
        useThumbnailHeartbeat("room-1", true, tracker)
      )

      // A capture fires, then the frame re-dirties and the tab closes before the
      // new settle window lands — still within the min-refresh gap, so the
      // unmount flush is suppressed rather than firing a near-duplicate capture.
      act(() => {
        tracker.setReady("a", true)
        vi.advanceTimersByTime(SETTLE_MS)
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)

      act(() => {
        tracker.markDirty("a")
        // Less than both the settle window (timer still pending) and the refresh
        // gap (so the flush is suppressed).
        vi.advanceTimersByTime(Math.min(SETTLE_MS, MIN_REFRESH_GAP_MS) / 2)
        unmount()
      })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it("does not flush on unmount when nothing was scheduled", () => {
      const tracker = new DirtyFrameTracker()
      const { unmount } = renderHook(() =>
        useThumbnailHeartbeat("room-1", true, tracker)
      )
      act(() => unmount())
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })
})
