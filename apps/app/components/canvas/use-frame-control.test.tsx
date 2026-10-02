// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it } from "vitest"
import * as Y from "yjs"

import {
  AGENT_PARTY,
  frameControlKey,
  reduceFrameControl,
  EMPTY_FRAME_CONTROL,
} from "@/lib/canvas/frame-control"
import { createRoomCollections, type RoomCollections } from "@/lib/yjs/schema"
import { useFrameControl } from "./use-frame-control"

const FRAME = "frame-1"
const ME = "zack"

afterEach(cleanup)

/** Two docs that pass every update to each other, like two synced clients. */
function syncedPair(): [Y.Doc, Y.Doc] {
  const a = new Y.Doc()
  const b = new Y.Doc()
  a.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "peer") Y.applyUpdate(b, u, "peer")
  })
  b.on("update", (u: Uint8Array, origin: unknown) => {
    if (origin !== "peer") Y.applyUpdate(a, u, "peer")
  })
  return [a, b]
}

/** The agent driving this viewer's copy of the frame, as the server writes it. */
function agentDrives(c: RoomCollections) {
  c.frameControl.set(
    frameControlKey(FRAME, ME),
    reduceFrameControl(EMPTY_FRAME_CONTROL, {
      type: "chat-ask",
      asker: ME,
      at: 0,
    })
  )
}

function renderFrameControl(c: RoomCollections) {
  return renderHook(() => {
    const [focusedId, setFocusedId] = useState<string | null>(null)
    const control = useFrameControl({
      collection: c.frameControl,
      viewerId: ME,
      others: [],
      frameIds: [FRAME],
      focusedId,
      setFocusedId,
    })
    return { control, focusedId, setFocusedId }
  })
}

describe("useFrameControl", () => {
  it("syncs the driver record between clients through the Room's doc", () => {
    const [server, client] = syncedPair()
    agentDrives(createRoomCollections(server))
    const { result } = renderFrameControl(createRoomCollections(client))
    expect(result.current.control.driverOf(FRAME)).toEqual({ kind: "agent" })
  })

  it("makes you the driver at once when you click while the agent drives", () => {
    const [server, client] = syncedPair()
    const serverRoom = createRoomCollections(server)
    agentDrives(serverRoom)
    const { result } = renderFrameControl(createRoomCollections(client))

    act(() => result.current.control.interact(FRAME))

    expect(result.current.focusedId).toBe(FRAME)
    expect(result.current.control.driverOf(FRAME)).toEqual({ kind: "you" })
    expect(
      serverRoom.frameControl.get(frameControlKey(FRAME, ME))?.driver
    ).toBe(ME)
  })

  it("lets go of the frame when you leave Interact", () => {
    const doc = new Y.Doc()
    const c = createRoomCollections(doc)
    const { result } = renderFrameControl(c)

    act(() => result.current.control.interact(FRAME))
    expect(result.current.control.driverOf(FRAME)).toEqual({ kind: "you" })

    act(() => result.current.setFocusedId(null))
    expect(result.current.control.driverOf(FRAME)).toEqual({ kind: "none" })
    expect(c.frameControl.has(frameControlKey(FRAME, ME))).toBe(false)
  })

  it("hands the frame back to the agent that asked again", () => {
    const doc = new Y.Doc()
    const c = createRoomCollections(doc)
    agentDrives(c)
    const { result } = renderFrameControl(c)
    act(() => result.current.control.interact(FRAME))

    const key = frameControlKey(FRAME, ME)
    act(() =>
      c.frameControl.set(
        key,
        reduceFrameControl(c.frameControl.get(key)!, {
          type: "request",
          by: AGENT_PARTY,
          at: 1,
        })
      )
    )
    expect(result.current.control.driverOf(FRAME)).toEqual({ kind: "you" })

    act(() => result.current.setFocusedId(null))
    expect(result.current.control.driverOf(FRAME)).toEqual({ kind: "agent" })
  })

  it("ends Interact when you hand the frame to the agent from chat", () => {
    const doc = new Y.Doc()
    const c = createRoomCollections(doc)
    const { result } = renderFrameControl(c)
    act(() => result.current.control.interact(FRAME))

    const key = frameControlKey(FRAME, ME)
    act(() =>
      c.frameControl.set(
        key,
        reduceFrameControl(c.frameControl.get(key)!, {
          type: "chat-ask",
          asker: ME,
          at: 1,
        })
      )
    )
    expect(result.current.focusedId).toBeNull()
    expect(result.current.control.driverOf(FRAME)).toEqual({ kind: "agent" })
  })

  it("lets go of a seat left behind by a tab that closed mid-Interact", () => {
    const doc = new Y.Doc()
    const c = createRoomCollections(doc)
    c.frameControl.set(frameControlKey(FRAME, ME), {
      live: false,
      driver: ME,
      requests: [],
    })
    const { result } = renderFrameControl(c)
    expect(result.current.control.driverOf(FRAME)).toEqual({ kind: "none" })
  })
})
