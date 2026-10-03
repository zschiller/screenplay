import { describe, expect, it } from "vitest"
import * as Y from "yjs"

import {
  frameControlKey,
  reduceFrameControl,
  type FrameControlPresence,
} from "@/lib/canvas/frame-control"
import { agentAsksInChat, agentLetsGo } from "@/lib/frame-drive/agent-driver"
import { roomFrameControlStore } from "@/lib/frame-drive/server"
import { liveFrames } from "@/lib/frame-stream/live-frames"
import type { RoomDoc } from "@/lib/room-access"
import { createRoomCollections } from "@/lib/yjs/schema"

const FRAME = "f1"
const PRESENCE: FrameControlPresence = {
  online: new Set(["zack"]),
  goneAt: new Map(),
}

function room() {
  const c = createRoomCollections(new Y.Doc())
  c.iframeLayers.set(FRAME, {
    id: FRAME,
    branchId: "b1",
    route: "/",
    width: 800,
    height: 600,
  } as never)
  const doc: RoomDoc = {
    roomId: "room-1",
    readDoc: async (fn) => fn(c),
    mutateDoc: async (fn) => fn(c),
  }
  return { c, doc }
}

/** The hosted agent's store for a shared frame, and the rule's answer for a
 *  canvas nobody is on. */
function hosted() {
  const { c, doc } = room()
  const store = roomFrameControlStore(doc, { live: true })
  const key = frameControlKey(FRAME, "", true)
  const agentStarts = () =>
    store.update(
      key,
      (record) =>
        agentAsksInChat(record, {
          asker: "zack",
          at: 1,
          heldBefore: false,
          takenBy: null,
        }).record
    )
  const live = () =>
    liveFrames({
      frameIds: [FRAME],
      turnedLive: (id) => c.iframeLayers.get(id)?.live === true,
      viewerId: null,
      others: [],
      drivers: (id) =>
        c.frameControl.get(frameControlKey(id, "", true))?.driver,
    }).get(FRAME)!.live
  return { c, store, key, agentStarts, live }
}

describe("roomFrameControlStore on a hosted shared frame", () => {
  it("turns the frame live when the agent picks it up", async () => {
    const { c, agentStarts, live } = hosted()
    await agentStarts()
    expect(c.iframeLayers.get(FRAME)?.live).toBe(true)
    expect(live()).toBe(true)
  })

  it("keeps the frame live after the agent hands it back, with nobody on it", async () => {
    const { c, store, key, agentStarts, live } = hosted()
    await agentStarts()
    await store.update(key, (record) => agentLetsGo(record, PRESENCE))
    expect(c.frameControl.get(key)).toBeUndefined()
    expect(live()).toBe(true)
  })

  it("keeps the frame live when a person takes over from the agent", async () => {
    const { c, store, key, agentStarts, live } = hosted()
    await agentStarts()
    await store.update(key, (record) =>
      reduceFrameControl(record, { type: "request", by: "zack", at: 2 })
    )
    expect(c.frameControl.get(key)?.driver).toBe("zack")
    expect(live()).toBe(true)
  })

  it("doesn't turn the frame back on with each step after someone ended live", async () => {
    const { c, store, key, agentStarts, live } = hosted()
    await agentStarts()
    c.iframeLayers.update(FRAME, { live: false })
    await agentStarts()
    expect(c.iframeLayers.get(FRAME)?.live).toBe(false)
    // Still live while the agent drives, then back to own copies.
    expect(live()).toBe(true)
    await store.update(key, (record) => agentLetsGo(record, PRESENCE))
    expect(live()).toBe(false)
  })
})

describe("roomFrameControlStore on a per-viewer frame", () => {
  it("never turns the frame live (the desktop app has no live frames)", async () => {
    const { c, doc } = room()
    const store = roomFrameControlStore(doc)
    await store.update(
      frameControlKey(FRAME, "zack"),
      (record) =>
        agentAsksInChat(record, {
          asker: "zack",
          at: 1,
          heldBefore: false,
          takenBy: null,
        }).record
    )
    expect(c.iframeLayers.get(FRAME)?.live).toBeUndefined()
  })
})
