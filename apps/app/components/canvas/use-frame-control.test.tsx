// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import * as Y from "yjs"

import {
  AGENT_PARTY,
  FRAME_CONTROL_GRACE_MS,
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

  describe("on a shared frame (#1392)", () => {
    const SHARED = new Set([FRAME])
    const NAMES: Record<string, string> = {
      ana: "Ana",
      ben: "Ben",
      cara: "Cara",
    }
    const presenceOf = (id: string, color = "#f60") => ({
      presence: {
        identity: { id, name: NAMES[id] ?? id },
        pointer: null,
        viewport: { x: 0, y: 0, zoom: 1 },
        color,
        selectedIframeLayerIds: [],
      },
    })

    function renderViewer(
      c: RoomCollections,
      viewerId: string,
      ...others: string[]
    ) {
      return renderHook(
        ({ online }: { online: string[] }) => {
          const [focusedId, setFocusedId] = useState<string | null>(null)
          const control = useFrameControl({
            collection: c.frameControl,
            viewerId,
            others: online.map((id) => presenceOf(id)),
            frameIds: [FRAME],
            sharedIds: SHARED,
            focusedId,
            setFocusedId,
          })
          return { control, focusedId, setFocusedId }
        },
        { initialProps: { online: others } }
      )
    }

    /** Three clients on one doc, as if synced: Ana, Ben and Cara. */
    function threeViewers() {
      const c = createRoomCollections(new Y.Doc())
      return {
        c,
        ana: renderViewer(c, "ana", "ben", "cara"),
        ben: renderViewer(c, "ben", "ana", "cara"),
        cara: renderViewer(c, "cara", "ana", "ben"),
      }
    }

    it("keeps one live record that every viewer sees", () => {
      const [a, b] = syncedPair()
      const anaRoom = createRoomCollections(a)
      const ana = renderViewer(anaRoom, "ana", "ben")
      const ben = renderViewer(createRoomCollections(b), "ben", "ana")

      act(() => ana.result.current.control.interact(FRAME))

      expect(anaRoom.frameControl.get(FRAME)).toEqual({
        live: true,
        driver: "ana",
        requests: [],
      })
      expect(ana.result.current.control.driverOf(FRAME)).toEqual({
        kind: "you",
      })
      expect(ben.result.current.control.driverOf(FRAME)).toMatchObject({
        kind: "person",
        id: "ana",
        name: "Ana",
      })
    })

    it("asks the person driving instead of taking the frame", () => {
      const [a, b] = syncedPair()
      const anaRoom = createRoomCollections(a)
      const ana = renderViewer(anaRoom, "ana", "ben")
      const ben = renderViewer(createRoomCollections(b), "ben", "ana")
      act(() => ana.result.current.control.interact(FRAME))

      act(() => ben.result.current.control.interact(FRAME))

      expect(ben.result.current.focusedId).toBeNull()
      expect(anaRoom.frameControl.get(FRAME)).toMatchObject({
        driver: "ana",
        requests: [{ by: "ben" }],
      })
    })

    it("shows the driver who asked, and hands over on Give control", () => {
      const { ana, ben } = threeViewers()
      act(() => ana.result.current.control.interact(FRAME))
      act(() => ben.result.current.control.interact(FRAME))

      expect(ben.result.current.control.askedFor(FRAME)).toBe(true)
      expect(ana.result.current.control.requestsOf(FRAME)).toEqual([
        { id: "ben", name: "Ben", color: "#f60", avatar: undefined },
      ])
      // Only the driver is asked.
      expect(ben.result.current.control.requestsOf(FRAME)).toEqual([])

      act(() => ana.result.current.control.grant(FRAME, "ben"))

      expect(ben.result.current.control.driverOf(FRAME)).toEqual({
        kind: "you",
      })
      expect(ben.result.current.focusedId).toBe(FRAME)
      expect(ana.result.current.focusedId).toBeNull()
      expect(ana.result.current.control.driverOf(FRAME)).toMatchObject({
        kind: "person",
        id: "ben",
      })
    })

    it("queues simultaneous asks, oldest first, for the driver to pick", () => {
      const { ana, ben, cara } = threeViewers()
      act(() => ana.result.current.control.interact(FRAME))
      act(() => ben.result.current.control.interact(FRAME))
      act(() => cara.result.current.control.interact(FRAME))

      expect(
        ana.result.current.control.requestsOf(FRAME).map((r) => r.id)
      ).toEqual(["ben", "cara"])

      act(() => ana.result.current.control.grant(FRAME, "cara"))

      expect(cara.result.current.focusedId).toBe(FRAME)
      expect(
        cara.result.current.control.requestsOf(FRAME).map((r) => r.id)
      ).toEqual(["ben"])
      expect(ben.result.current.focusedId).toBeNull()
    })

    it("keeps the driver on Not now and drops the ask", () => {
      const { c, ana, ben } = threeViewers()
      act(() => ana.result.current.control.interact(FRAME))
      act(() => ben.result.current.control.interact(FRAME))

      act(() => ana.result.current.control.decline(FRAME, "ben"))

      expect(c.frameControl.get(FRAME)).toMatchObject({
        driver: "ana",
        requests: [],
      })
      expect(ana.result.current.focusedId).toBe(FRAME)
      expect(ben.result.current.control.askedFor(FRAME)).toBe(false)
    })

    it("takes the ask back when the asker clicks again", () => {
      const { c, ana, ben } = threeViewers()
      act(() => ana.result.current.control.interact(FRAME))
      act(() => ben.result.current.control.interact(FRAME))

      act(() => ben.result.current.control.interact(FRAME))

      expect(c.frameControl.get(FRAME)?.requests).toEqual([])
      expect(ana.result.current.control.requestsOf(FRAME)).toEqual([])
    })

    it("hands control to whoever asked when the driver leaves Interact", () => {
      const { ana, ben } = threeViewers()
      act(() => ana.result.current.control.interact(FRAME))
      act(() => ben.result.current.control.interact(FRAME))

      act(() => ana.result.current.setFocusedId(null))

      expect(ben.result.current.focusedId).toBe(FRAME)
      expect(ben.result.current.control.driverOf(FRAME)).toEqual({
        kind: "you",
      })
    })

    describe("over time", () => {
      afterEach(() => vi.useRealTimers())

      it("gives the seat back to a driver who reloads within the grace", () => {
        vi.useFakeTimers()
        const { c, ana, ben } = threeViewers()
        act(() => ana.result.current.control.interact(FRAME))
        act(() => ben.result.current.control.interact(FRAME))

        // Ana's tab reloads: her client goes, Ben sees her leave...
        ana.unmount()
        ben.rerender({ online: ["cara"] })
        act(() => vi.advanceTimersByTime(FRAME_CONTROL_GRACE_MS - 1000))
        // ...and she's back before the grace runs out.
        ben.rerender({ online: ["ana", "cara"] })
        const reloaded = renderViewer(c, "ana", "ben", "cara")

        act(() => vi.advanceTimersByTime(FRAME_CONTROL_GRACE_MS))
        expect(c.frameControl.get(FRAME)?.driver).toBe("ana")
        expect(reloaded.result.current.focusedId).toBe(FRAME)
        expect(reloaded.result.current.control.requestsOf(FRAME)).toEqual([
          expect.objectContaining({ id: "ben" }),
        ])
      })

      it("passes control to the oldest online asker when the driver is gone", () => {
        vi.useFakeTimers()
        const { c, ana, ben, cara } = threeViewers()
        act(() => ana.result.current.control.interact(FRAME))
        act(() => ben.result.current.control.interact(FRAME))
        act(() => cara.result.current.control.interact(FRAME))

        ana.unmount()
        ben.rerender({ online: ["cara"] })
        cara.rerender({ online: ["ben"] })
        expect(c.frameControl.get(FRAME)?.driver).toBe("ana")

        act(() => vi.advanceTimersByTime(FRAME_CONTROL_GRACE_MS))

        expect(c.frameControl.get(FRAME)?.driver).toBe("ben")
        expect(ben.result.current.focusedId).toBe(FRAME)
        expect(cara.result.current.control.askedFor(FRAME)).toBe(true)
      })

      it("doesn't count the driver gone before a new viewer sees them", () => {
        vi.useFakeTimers()
        const c = createRoomCollections(new Y.Doc())
        c.frameControl.set(FRAME, { live: true, driver: "ana", requests: [] })

        // Ben's client just loaded: Ana's presence hasn't arrived yet.
        const ben = renderViewer(c, "ben")
        act(() => vi.advanceTimersByTime(1000))
        expect(c.frameControl.get(FRAME)?.driver).toBe("ana")

        ben.rerender({ online: ["ana"] })
        act(() => vi.advanceTimersByTime(FRAME_CONTROL_GRACE_MS))
        expect(c.frameControl.get(FRAME)?.driver).toBe("ana")
      })
    })

    describe("going local (#1397)", () => {
      /** A viewer who can switch the frame to their own local copy. */
      function renderLocalViewer(
        c: RoomCollections,
        viewerId: string,
        other: string
      ) {
        return renderHook(() => {
          const [focusedId, setFocusedId] = useState<string | null>(null)
          const [local, setLocal] = useState(false)
          const control = useFrameControl({
            collection: c.frameControl,
            viewerId,
            others: [presenceOf(other, "#f60")],
            frameIds: [FRAME],
            sharedIds: local ? new Set<string>() : SHARED,
            focusedId,
            setFocusedId,
          })
          return { control, focusedId, setLocal }
        })
      }

      it("lets go of the shared frame when its driver goes local", () => {
        const [a, b] = syncedPair()
        const anaRoom = createRoomCollections(a)
        const ana = renderLocalViewer(anaRoom, "ana", "ben")
        const ben = renderLocalViewer(createRoomCollections(b), "ben", "ana")
        act(() => ana.result.current.control.interact(FRAME))

        act(() => {
          ana.result.current.control.letGo(FRAME)
          ana.result.current.setLocal(true)
        })

        // Nobody drives the shared frame now; Ben can pick it up.
        expect(anaRoom.frameControl.has(FRAME)).toBe(false)
        expect(ben.result.current.control.driverOf(FRAME)).toEqual({
          kind: "none",
        })
        // Ana's local copy is hers alone, and driving it isn't driving the
        // shared frame.
        expect(ana.result.current.focusedId).toBeNull()
        act(() => ana.result.current.control.interact(FRAME))
        expect(ana.result.current.control.driverOf(FRAME)).toEqual({
          kind: "you",
        })
        expect(anaRoom.frameControl.has(FRAME)).toBe(false)
        expect(ben.result.current.control.driverOf(FRAME)).toEqual({
          kind: "none",
        })
      })

      it("hands the shared frame to whoever asked when its driver goes local", () => {
        const [a, b] = syncedPair()
        const anaRoom = createRoomCollections(a)
        const ana = renderLocalViewer(anaRoom, "ana", "ben")
        const ben = renderLocalViewer(createRoomCollections(b), "ben", "ana")
        act(() => ana.result.current.control.interact(FRAME))
        act(() => ben.result.current.control.interact(FRAME))

        act(() => {
          ana.result.current.control.letGo(FRAME)
          ana.result.current.setLocal(true)
        })

        expect(anaRoom.frameControl.get(FRAME)).toMatchObject({
          driver: "ben",
          requests: [],
        })
        expect(ben.result.current.focusedId).toBe(FRAME)
      })

      it("withdraws your ask to drive the shared frame", () => {
        const [a, b] = syncedPair()
        const anaRoom = createRoomCollections(a)
        const ana = renderLocalViewer(anaRoom, "ana", "ben")
        const ben = renderLocalViewer(createRoomCollections(b), "ben", "ana")
        act(() => ana.result.current.control.interact(FRAME))
        act(() => ben.result.current.control.interact(FRAME))

        act(() => {
          ben.result.current.control.letGo(FRAME)
          ben.result.current.setLocal(true)
        })

        expect(anaRoom.frameControl.get(FRAME)).toMatchObject({
          driver: "ana",
          requests: [],
        })
      })
    })
  })
})
