// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"

import type {
  FrameStreamConnection,
  GoLiveFailure,
} from "@/lib/frame-stream/client"
import { GO_LIVE_FAILED, useGoLive } from "./use-go-live"

const FRAME = "frame-1"
const RUNNING = { status: "running" as const }

/** A Workspace's stream whose frame's first picture we settle by hand. */
function fakeStream() {
  let settle = (_: GoLiveFailure | null) => {}
  const firstPicture = vi.fn(
    () => new Promise<GoLiveFailure | null>((r) => (settle = r))
  )
  const stream = {
    frame: () => ({ firstPicture }),
  } as unknown as FrameStreamConnection
  return {
    stream,
    firstPicture,
    settle: (f: GoLiveFailure | null) => settle(f),
  }
}

/** The hook over a frame whose live flag follows `setLive`, as the room's
 *  synced flag does. */
function renderGoLive() {
  const onFailed = vi.fn()
  const live = new Set<string>()
  const setLive = vi.fn((id: string, on: boolean) => {
    if (on) live.add(id)
    else live.delete(id)
  })
  const hook = renderHook(
    ({ liveIds }) => useGoLive({ setLive, onFailed, liveIds }),
    { initialProps: { liveIds: new Set(live) as ReadonlySet<string> } }
  )
  const sync = () => hook.rerender({ liveIds: new Set(live) })
  const click = (stream: FrameStreamConnection, workspace = RUNNING) =>
    act(() => {
      hook.result.current.toggle({
        id: FRAME,
        live: live.has(FRAME),
        stream,
        workspace,
      })
      sync()
    })
  return { ...hook, setLive, onFailed, live, sync, click }
}

afterEach(cleanup)

describe("useGoLive", () => {
  it("goes live and is pending until the first picture", async () => {
    const { stream, settle } = fakeStream()
    const { result, click, setLive, onFailed } = renderGoLive()
    click(stream)
    expect(setLive).toHaveBeenCalledWith(FRAME, true)
    expect(result.current.pendingIds.has(FRAME)).toBe(true)
    await act(async () => settle(null))
    expect(result.current.pendingIds.has(FRAME)).toBe(false)
    expect(onFailed).not.toHaveBeenCalled()
  })

  it("ignores a second click while pending", () => {
    const { stream, firstPicture } = fakeStream()
    const { click, setLive, live } = renderGoLive()
    click(stream)
    click(stream)
    expect(setLive).toHaveBeenCalledTimes(1)
    expect(firstPicture).toHaveBeenCalledTimes(1)
    expect(live.has(FRAME)).toBe(true)
  })

  it("turns the frame back off and says why when it fails", async () => {
    const { stream, settle } = fakeStream()
    const { result, click, setLive, onFailed, live } = renderGoLive()
    click(stream)
    await act(async () => settle("failed"))
    expect(setLive).toHaveBeenLastCalledWith(FRAME, false)
    expect(live.has(FRAME)).toBe(false)
    expect(onFailed).toHaveBeenCalledWith(GO_LIVE_FAILED.failed)
    expect(result.current.pendingIds.size).toBe(0)
  })

  it("refuses at once when the workspace isn't running", () => {
    const { stream, firstPicture } = fakeStream()
    const { click, setLive, onFailed } = renderGoLive()
    click(stream, { status: "stopped" } as unknown as typeof RUNNING)
    expect(setLive).not.toHaveBeenCalled()
    expect(firstPicture).not.toHaveBeenCalled()
    expect(onFailed).toHaveBeenCalledWith(GO_LIVE_FAILED["not-running"])
  })

  it("ends live at once on a click when it's live", () => {
    const { stream } = fakeStream()
    const { result, click, setLive, live } = renderGoLive()
    live.add(FRAME)
    click(stream)
    expect(setLive).toHaveBeenCalledWith(FRAME, false)
    expect(result.current.pendingIds.size).toBe(0)
  })

  it("stops waiting without a word when someone else ends it", async () => {
    const { stream, settle } = fakeStream()
    const { result, click, sync, onFailed, live, setLive } = renderGoLive()
    click(stream)
    live.delete(FRAME)
    act(() => sync())
    expect(result.current.pendingIds.size).toBe(0)
    await act(async () => settle("timeout"))
    expect(onFailed).not.toHaveBeenCalled()
    expect(setLive).toHaveBeenCalledTimes(1)
  })
})
