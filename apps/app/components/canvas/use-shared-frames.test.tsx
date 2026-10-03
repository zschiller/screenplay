// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

import { AGENT_PARTY } from "@/lib/canvas/frame-control"
import type { FrameSnapshot } from "@/lib/frame-stream/protocol"
import type { CanvasPresence } from "@/lib/yjs/react"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { LANDING_WINDOW_MS, useSharedFrames } from "./use-shared-frames"

/** A Workspace's Frame Stream that says its frames can go live. */
const fakeStream = {
  availability: "shared" as "checking" | "shared" | "unshared",
  check: vi.fn(),
  subscribeAvailability: vi.fn(() => () => {}),
  snapshot: vi.fn(async (): Promise<FrameSnapshot | null> => ({
    path: "/checkout",
    cookies: [],
    localStorage: [],
  })),
}
vi.mock("@/lib/frame-stream/client", () => ({
  frameStreamFor: () => fakeStream,
}))
const seedLocalFrame = vi.fn(async () => true)
vi.mock("@/lib/frame-stream/seed", () => ({
  seedLocalFrame: (...args: unknown[]) => seedLocalFrame(...(args as [])),
}))

const ME = "zack"
const FRAME = { id: "frame-1", branchId: "ws-1" }
const AGENTS = [{ id: "ws-1", previewDomain: "https://ws-1.preview.test" }]

function person(id: string, liveFrameIds?: string[]) {
  return {
    presence: {
      identity: { id, name: id },
      pointer: null,
      viewport: { x: 0, y: 0, zoom: 1 },
      color: "#FFB74D",
      selectedIframeLayerIds: [],
      liveFrameIds,
    } satisfies CanvasPresence,
  }
}

function renderShared({
  others = [] as ReturnType<typeof person>[],
  enabled = true,
  room = createRoomCollections(new Y.Doc()),
} = {}) {
  const setPresence = vi.fn()
  const hook = renderHook(
    ({ others }) =>
      useSharedFrames({
        roomId: "room-1",
        enabled,
        agents: AGENTS,
        iframeLayers: [FRAME],
        viewerId: ME,
        others,
        setPresence,
        frameControl: room.frameControl,
      }),
    { initialProps: { others } }
  )
  return { ...hook, setPresence, room }
}

/** What this viewer last said in presence it's live on. */
function saidLiveOn(setPresence: ReturnType<typeof vi.fn>) {
  const calls = setPresence.mock.calls.filter(
    ([p]) => (p as Partial<CanvasPresence>).liveFrameIds !== undefined
  )
  return (calls.at(-1)?.[0] as Partial<CanvasPresence>).liveFrameIds
}

beforeEach(() => {
  fakeStream.availability = "shared"
  seedLocalFrame.mockClear()
  fakeStream.snapshot.mockClear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe("useSharedFrames", () => {
  it("opens every frame as your own copy, streaming nothing", () => {
    const { result, setPresence } = renderShared()
    expect(result.current.liveOf(FRAME.id)).toEqual({
      live: false,
      on: [],
      viewerOn: false,
    })
    expect(result.current.sharedIds.size).toBe(0)
    expect(saidLiveOn(setPresence)).toEqual([])
  })

  it("puts only you on a frame you go live on, and says so in presence", () => {
    const { result, setPresence } = renderShared()
    act(() => result.current.goLive(FRAME))
    expect(result.current.liveOf(FRAME.id)).toEqual({
      live: true,
      on: [ME],
      viewerOn: true,
    })
    expect(result.current.sharedIds.has(FRAME.id)).toBe(true)
    expect(saidLiveOn(setPresence)).toEqual([FRAME.id])
  })

  it("leaves for an own copy seeded from the live page", async () => {
    const { result, setPresence } = renderShared()
    act(() => result.current.goLive(FRAME))
    await act(async () => result.current.leave(FRAME))
    expect(fakeStream.snapshot).toHaveBeenCalledWith(FRAME.id)
    expect(seedLocalFrame).toHaveBeenCalledWith(
      "https://ws-1.preview.test",
      expect.objectContaining({ path: "/checkout" })
    )
    expect(result.current.liveOf(FRAME.id).viewerOn).toBe(false)
    expect(saidLiveOn(setPresence)).toEqual([])
  })

  it("shows someone else's live frame as live without pulling you in", () => {
    vi.useFakeTimers()
    const { result, rerender } = renderShared()
    vi.advanceTimersByTime(LANDING_WINDOW_MS + 1)
    rerender({ others: [person("ana", [FRAME.id])] })
    expect(result.current.liveOf(FRAME.id)).toEqual({
      live: true,
      on: ["ana"],
      viewerOn: false,
    })
  })

  it("lands you on a frame that's live when the canvas opens", () => {
    const { result } = renderShared({ others: [person("ana", [FRAME.id])] })
    expect(result.current.liveOf(FRAME.id)).toEqual({
      live: true,
      on: [ME, "ana"],
      viewerOn: true,
    })
  })

  it("doesn't put you back on a frame you left", async () => {
    const { result, rerender } = renderShared({
      others: [person("ana", [FRAME.id])],
    })
    await act(async () => result.current.leave(FRAME))
    rerender({ others: [person("ana", [FRAME.id]), person("ben", [FRAME.id])] })
    expect(result.current.liveOf(FRAME.id)).toEqual({
      live: true,
      on: ["ana", "ben"],
      viewerOn: false,
    })
  })

  it("ends live when the last person drops off", () => {
    vi.useFakeTimers()
    const { result, rerender } = renderShared()
    vi.advanceTimersByTime(LANDING_WINDOW_MS + 1)
    rerender({ others: [person("ana", [FRAME.id])] })
    expect(result.current.liveOf(FRAME.id).live).toBe(true)
    rerender({ others: [] })
    expect(result.current.liveOf(FRAME.id).live).toBe(false)
  })

  it("keeps the frame live while the agent has control", () => {
    const room: RoomCollections = createRoomCollections(new Y.Doc())
    room.frameControl.set(FRAME.id, {
      live: true,
      driver: AGENT_PARTY,
      requests: [],
    })
    vi.useFakeTimers()
    const { result } = renderShared({ room })
    expect(result.current.liveOf(FRAME.id).on).toContain(AGENT_PARTY)
  })

  it("offers no live frames where frames can't go live", () => {
    fakeStream.availability = "unshared"
    const { result } = renderShared({ others: [person("ana", [FRAME.id])] })
    act(() => result.current.goLive(FRAME))
    expect(result.current.liveOf(FRAME.id).live).toBe(false)
    expect(result.current.streamOf(FRAME.branchId)).toBeUndefined()
  })

  it("offers nothing on the desktop app", () => {
    const { result } = renderShared({ enabled: false })
    expect(result.current.streamOf(FRAME.branchId)).toBeUndefined()
  })
})
