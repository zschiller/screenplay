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
// Force the hosted cadence (PERIOD 30s) and keep the initial mount fire off the
// `isLocalBuild` path so tests opt into it via `hasThumbnail`.
vi.mock("@/lib/local-mode", () => ({ isLocalBuild: false }))

import { useThumbnailHeartbeat } from "./use-thumbnail-heartbeat"

const PERIOD_MS = 30_000
const INITIAL_DELAY_MS = 3_000
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
  it("coalesces dirty frames into one throttled fire carrying the subset", () => {
    const tracker = new DirtyFrameTracker()
    renderHook(() => useThumbnailHeartbeat("room-1", true, tracker))

    // Two frames load within the same window — one fire should carry both.
    act(() => {
      tracker.setReady("a", true)
      tracker.setReady("b", true)
    })
    expect(fetchMock).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(PERIOD_MS))

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]!
    expect(url).toBe(URL)
    expect((init as RequestInit).method).toBe("POST")
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ frameIds: ["a", "b"] })

    // The posted frames are cleared, so an idle next window posts an empty
    // (layout-only) subset rather than re-capturing them.
    act(() => {
      emitUpdate()
      vi.advanceTimersByTime(PERIOD_MS)
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bodyOf(fetchMock.mock.calls[1])).toEqual({ frameIds: [] })
  })

  it("throttles: a burst of changes still fires at most once per period", () => {
    const tracker = new DirtyFrameTracker()
    renderHook(() => useThumbnailHeartbeat("room-1", true, tracker))

    act(() => tracker.setReady("a", true))
    // Keep dirtying inside the window — none of these reset the timer.
    act(() => {
      vi.advanceTimersByTime(PERIOD_MS / 2)
      tracker.markDirty("a")
      vi.advanceTimersByTime(PERIOD_MS / 2 - 1)
      tracker.markDirty("a")
    })
    expect(fetchMock).not.toHaveBeenCalled()

    act(() => vi.advanceTimersByTime(1))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("posts an empty subset for a layout-only Y.Doc update", () => {
    const tracker = new DirtyFrameTracker()
    renderHook(() => useThumbnailHeartbeat("room-1", true, tracker))

    // A move/resize/rename is a doc update with no frame dirty.
    act(() => {
      emitUpdate()
      vi.advanceTimersByTime(PERIOD_MS)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ frameIds: [] })
  })

  it("fires a full capture (no body) on mount when the room has no thumbnail", () => {
    const tracker = new DirtyFrameTracker()
    renderHook(() => useThumbnailHeartbeat("room-1", false, tracker))

    act(() => vi.advanceTimersByTime(INITIAL_DELAY_MS))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const init = fetchMock.mock.calls[0]![1] as RequestInit
    expect(init.method).toBe("POST")
    expect(init.body).toBeUndefined()
  })

  it("flushes a scheduled-but-unfired window on unmount (edit then close)", () => {
    const tracker = new DirtyFrameTracker()
    const { unmount } = renderHook(() =>
      useThumbnailHeartbeat("room-1", true, tracker)
    )

    act(() => {
      tracker.setReady("a", true)
      vi.advanceTimersByTime(PERIOD_MS / 2) // close before the fire lands
    })
    expect(fetchMock).not.toHaveBeenCalled()

    act(() => unmount())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bodyOf(fetchMock.mock.calls[0])).toEqual({ frameIds: ["a"] })
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
