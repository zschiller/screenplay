// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

import { AGENT_PARTY } from "@/lib/canvas/frame-control"
import { NOT_LIVE } from "@/lib/frame-stream/live-frames"
import type { FrameSnapshot } from "@/lib/frame-stream/protocol"
import type { CanvasPresence } from "@/lib/yjs/react"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { useSharedFrames } from "./use-shared-frames"

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

function person(id: string, color = "#FFB74D") {
  return {
    presence: {
      identity: { id, name: id },
      pointer: null,
      viewport: { x: 0, y: 0, zoom: 1 },
      color,
      selectedIframeLayerIds: [],
    } satisfies CanvasPresence,
  }
}

function renderShared({
  others = [] as ReturnType<typeof person>[],
  live = false,
  enabled = true,
  room = createRoomCollections(new Y.Doc()),
} = {}) {
  const hook = renderHook(
    ({ others, live }) =>
      useSharedFrames({
        roomId: "room-1",
        enabled,
        agents: AGENTS,
        iframeLayers: [{ ...FRAME, live }],
        viewerId: ME,
        self: person(ME, "#FF8FC8").presence,
        others,
        frameControl: room.frameControl,
      }),
    { initialProps: { others, live } }
  )
  return { ...hook, room }
}

beforeEach(() => {
  fakeStream.availability = "shared"
  seedLocalFrame.mockClear()
  fakeStream.snapshot.mockClear()
})
afterEach(cleanup)

describe("useSharedFrames", () => {
  it("opens every frame as your own copy, streaming nothing", () => {
    const { result } = renderShared({ others: [person("ana")] })
    expect(result.current.liveOf(FRAME.id)).toEqual({
      live: false,
      on: [],
      viewerOn: false,
    })
    expect(result.current.sharedIds.size).toBe(0)
  })

  it("puts everyone on a frame someone turns live", () => {
    const { result, rerender } = renderShared({ others: [person("ana")] })
    rerender({ others: [person("ana")], live: true })
    expect(result.current.liveOf(FRAME.id)).toEqual({
      live: true,
      on: [ME, "ana"],
      viewerOn: true,
    })
    expect(result.current.sharedIds.has(FRAME.id)).toBe(true)
  })

  it("shows the faces on a live frame in each person's cursor colour", () => {
    const ana = person("ana", "#7FD4FF")
    const { result, rerender } = renderShared({ others: [ana] })
    expect(result.current.facesOf(FRAME.id)).toEqual([])
    rerender({ others: [ana], live: true })
    expect(result.current.facesOf(FRAME.id)).toEqual([
      { kind: "person", id: ME, name: ME, color: "#FF8FC8" },
      { kind: "person", id: "ana", name: "ana", color: "#7FD4FF" },
    ])
    // Ana leaves, Ben joins (twice, from two tabs: one face).
    const ben = person("ben", "#B5F36B")
    rerender({ others: [ben, ben], live: true })
    expect(
      result.current.facesOf(FRAME.id).map((f) => f.kind === "person" && f.id)
    ).toEqual([ME, "ben"])
  })

  it("lands you on a frame that's live when the canvas opens", () => {
    const { result } = renderShared({ live: true })
    expect(result.current.liveOf(FRAME.id).viewerOn).toBe(true)
    expect(result.current.sharedIds.has(FRAME.id)).toBe(true)
  })

  it("ends live into an own copy seeded from the live page", async () => {
    const { result, rerender } = renderShared({ live: true })
    await act(async () => rerender({ others: [], live: false }))
    expect(fakeStream.snapshot).toHaveBeenCalledWith(FRAME.id)
    expect(seedLocalFrame).toHaveBeenCalledWith(
      "https://ws-1.preview.test",
      expect.objectContaining({ path: "/checkout" })
    )
    expect(result.current.liveOf(FRAME.id).live).toBe(false)
    expect(result.current.sharedIds.has(FRAME.id)).toBe(false)
  })

  it("keeps showing the stream until the own copy is seeded", async () => {
    let finish = (_: FrameSnapshot | null) => {}
    fakeStream.snapshot.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve))
    )
    const { result, rerender } = renderShared({ live: true })
    act(() => rerender({ others: [], live: false }))
    expect(result.current.sharedIds.has(FRAME.id)).toBe(true)
    await act(async () => finish(null))
    expect(result.current.sharedIds.has(FRAME.id)).toBe(false)
  })

  it("makes the frame live while the agent has control", () => {
    const room: RoomCollections = createRoomCollections(new Y.Doc())
    room.frameControl.set(FRAME.id, {
      live: true,
      driver: AGENT_PARTY,
      requests: [],
    })
    const { result } = renderShared({ room })
    expect(result.current.liveOf(FRAME.id).on).toEqual([ME, AGENT_PARTY])
    expect(result.current.facesOf(FRAME.id).at(-1)).toEqual({ kind: "agent" })
  })

  it("offers no live frames where frames can't go live", () => {
    fakeStream.availability = "unshared"
    const { result } = renderShared({ live: true })
    expect(result.current.liveOf(FRAME.id).live).toBe(false)
    expect(result.current.streamOf(FRAME.branchId)).toBeUndefined()
  })

  it("offers nothing on the desktop app", () => {
    const { result } = renderShared({ enabled: false })
    expect(result.current.streamOf(FRAME.branchId)).toBeUndefined()
  })
})

describe("useSharedFrames with Mockups (#1523)", () => {
  const MOCKUP = "mockup-1"

  function renderMockup({
    agents = AGENTS as { id: string; previewDomain: string }[],
    mockup = {} as { live?: boolean; liveBranchId?: string },
    owner = "ws-1" as string | undefined,
    enabled = true,
  } = {}) {
    const room = createRoomCollections(new Y.Doc())
    return renderHook(
      ({ mockup }) =>
        useSharedFrames({
          roomId: "room-1",
          enabled,
          agents,
          iframeLayers: [],
          mockupLayers: [{ id: MOCKUP, ...mockup }],
          mockupOwners: new Map(owner ? [[MOCKUP, owner]] : []),
          viewerId: ME,
          others: [person("ana")],
          frameControl: room.frameControl,
        }),
      { initialProps: { mockup } }
    )
  }

  it("opens a Mockup as your own copy, ready to go live in its chat's Workspace", () => {
    const { result } = renderMockup()
    expect(result.current.liveOf(MOCKUP)).toEqual(NOT_LIVE)
    expect(result.current.sharedIds.has(MOCKUP)).toBe(false)
    expect(result.current.mockupWorkspaceOf(MOCKUP)).toBe("ws-1")
    expect(result.current.mockupsGoLive).toBe(true)
  })

  it("puts everyone on a Mockup someone turns live", () => {
    const { result, rerender } = renderMockup()
    rerender({ mockup: { live: true, liveBranchId: "ws-1" } })
    expect(result.current.liveOf(MOCKUP)).toEqual({
      live: true,
      on: [ME, "ana"],
      viewerOn: true,
    })
    expect(result.current.sharedIds.has(MOCKUP)).toBe(true)
    // The Live tag's faces, as on a frame (#1519).
    expect(
      result.current.facesOf(MOCKUP).map((f) => f.kind === "person" && f.id)
    ).toEqual(["ana"])
  })

  it("ends live straight back to your own copy", async () => {
    const { result, rerender } = renderMockup({
      mockup: { live: true, liveBranchId: "ws-1" },
    })
    await act(async () => rerender({ mockup: { live: false } }))
    expect(fakeStream.snapshot).not.toHaveBeenCalled()
    expect(result.current.sharedIds.has(MOCKUP)).toBe(false)
  })

  it("isn't live once the Workspace it ran in stops", () => {
    const { result } = renderMockup({
      mockup: { live: true, liveBranchId: "ws-gone" },
    })
    expect(result.current.liveOf(MOCKUP).live).toBe(false)
    expect(result.current.mockupWorkspaceOf(MOCKUP)).toBe("ws-1")
  })

  it("can't go live with no Workspace running, and says so", () => {
    const { result } = renderMockup({ agents: [] })
    expect(result.current.mockupWorkspaceOf(MOCKUP)).toBeUndefined()
    expect(result.current.mockupsGoLive).toBe(true)
  })

  it("offers no Go live where frames can't go live", () => {
    fakeStream.availability = "unshared"
    expect(renderMockup().result.current.mockupsGoLive).toBe(false)
    expect(renderMockup({ enabled: false }).result.current.mockupsGoLive).toBe(
      false
    )
  })
})
