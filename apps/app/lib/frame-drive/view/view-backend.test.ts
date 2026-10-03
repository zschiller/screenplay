// @vitest-environment jsdom
import * as Y from "yjs"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { frameDriveContract } from "@/lib/frame-drive/contract-suite"
import type { DriveOp } from "@/lib/frame-drive/contract"
import type { FrameSnapshot } from "@/lib/frame-drive/mac/protocol"
import {
  createRelayFrames,
  runFrameDriveRelay,
} from "@/lib/frame-drive/mac/relay"
import {
  askBridge,
  PNG,
  startTestPage,
  testPage,
} from "@/lib/frame-drive/test-page"
import { memoryFrameDriveAnswers } from "@/lib/frame-drive/view/answers"
import {
  docRelaySocket,
  FRAME_DRIVE_ASK_TTL_MS,
} from "@/lib/frame-drive/view/asks"
import { viewFrameDriveBackend } from "@/lib/frame-drive/view/channel"
import { snapshotDocument } from "@/lib/frame-drive/view/render"
import type { RoomDoc } from "@/lib/room-access"
import { createRoomCollections } from "@/lib/yjs/schema"

/**
 * The hosted mockup backend (#1391) end to end, in a test page: the server's
 * channel writes asks into a Room doc that Ada's canvas shares, her canvas
 * runs them through the relay and the Sandbox Bridge in the page, and posts
 * the answers where the turn takes them. Ben's canvas shares the doc too, and
 * must never run Ada's asks.
 */

const ROOM = "drive-room"
const MOCKUP = "mockup-1"
const FRAME = "frame-1"
const ADA = "ada"
const BEN = "ben"

const doc = new Y.Doc()
const c = createRoomCollections(doc)
const room: RoomDoc = {
  roomId: ROOM,
  readDoc: async (fn) => fn(c),
  mutateDoc: async (fn) => fn(c),
}
const answers = memoryFrameDriveAnswers()
const rendered: FrameSnapshot[] = []
let agentDrives = true
const relays: { close(): void }[] = []
const benRan: unknown[] = []
const revealed: Record<string, string[]> = { [ADA]: [], [BEN]: [] }

function backendFor(viewer: string, opTimeoutMs = 3000) {
  return viewFrameDriveBackend(room, viewer, {
    answers,
    render: async (snapshot) => {
      rendered.push(snapshot)
      return { data: PNG, mediaType: "image/png" }
    },
    opTimeoutMs,
    snapshotTimeoutMs: opTimeoutMs,
    pollMs: 5,
  })
}
const backend = backendFor(ADA)

/** A viewer's canvas: the relay over the doc, posting to the answers. */
function connectCanvas(
  viewer: string,
  frames: ReturnType<typeof createRelayFrames>
) {
  const socket = docRelaySocket({
    asks: {
      entries: () => c.frameDriveAsks.toMap(),
      delete: (id) => c.frameDriveAsks.delete(id),
      observe: (listener) => c.frameDriveAsks.observe(listener),
    },
    viewerId: viewer,
    post: async (answer) => {
      await answers.accept(answer, { roomId: ROOM, viewer })
    },
  })
  relays.push(
    runFrameDriveRelay(socket, {
      frames,
      agentDrives: () => agentDrives,
      subscribeControl: () => () => {},
      reveal: async (frameId) => {
        revealed[viewer]?.push(frameId)
        return true
      },
    })
  )
}

beforeAll(() => {
  startTestPage()
  c.mockupLayers.set(MOCKUP, { id: MOCKUP, title: "Plans" } as never)
  c.iframeLayers.set(FRAME, { id: FRAME } as never)

  const adaFrames = createRelayFrames()
  adaFrames.register(MOCKUP, {
    drive: (op: DriveOp) => askBridge({ type: "screenplay:drive", op }),
    stop: () => void askBridge({ type: "screenplay:drive-stop" }),
    where: () => ({
      rect: null,
      window: { width: 0, height: 0 },
      zoom: 1,
      visibility: "visible",
    }),
    snapshot: () =>
      askBridge<FrameSnapshot>({
        type: "screenplay:dom-query",
        op: "getPageSnapshot",
        live: true,
      }),
  })
  connectCanvas(ADA, adaFrames)

  // Ben has the same mockup open, in his own copy.
  const benFrames = createRelayFrames()
  benFrames.register(MOCKUP, {
    drive: async (op) => {
      benRan.push(op)
      return { status: "failed", reason: "Ben's copy" }
    },
    stop: () => {},
    where: () => ({
      rect: null,
      window: { width: 0, height: 0 },
      zoom: 1,
      visibility: "visible",
    }),
  })
  connectCanvas(BEN, benFrames)
})

afterAll(() => {
  relays.forEach((relay) => relay.close())
})

frameDriveContract("hosted mockup (Sandbox Bridge in a test page)", {
  setup: async () => ({ backend, frameId: MOCKUP, ...testPage }),
  // The same bridge input as the Mac's, so the same gaps.
  gaps: [
    "file-picker",
    "native-picker",
    "native-select",
    "tab",
    "key-typing",
    "rich-text",
    "clipboard",
  ],
})

describe("hosted mockup drive channel", () => {
  it("drives in the asker's view only, and clears each ask", async () => {
    benRan.length = 0
    document.body.innerHTML = `<button id="save">Save</button>`
    const result = await backend.run(MOCKUP, {
      op: "click",
      target: { selector: "#save" },
    })
    expect(result.status).toBe("done")
    expect(benRan).toEqual([])
    expect(c.frameDriveAsks.toMap().size).toBe(0)
  })

  it("refuses a gesture when Frame Control says the agent no longer drives", async () => {
    agentDrives = false
    try {
      expect(
        await backend.run(MOCKUP, { op: "click", target: { text: "x" } })
      ).toEqual({ status: "taken" })
      expect((await backend.run(MOCKUP, { op: "elements" })).status).toBe(
        "read"
      )
    } finally {
      agentDrives = true
    }
  })

  it("takes an answer only from the person the op was for", async () => {
    await answers.expect("op-1", { roomId: ROOM, viewer: ADA })
    const answer = {
      type: "result" as const,
      id: "op-1",
      result: { status: "failed" as const, reason: "forged" },
    }
    expect(await answers.accept(answer, { roomId: ROOM, viewer: BEN })).toBe(
      false
    )
    expect(await answers.accept(answer, { roomId: "other", viewer: ADA })).toBe(
      false
    )
    expect(await answers.take("op-1")).toBeNull()
    expect(await answers.accept(answer, { roomId: ROOM, viewer: ADA })).toBe(
      true
    )
    expect(await answers.take("op-1")).toEqual(answer)
    await answers.forget("op-1")
  })

  it("renders the screenshot from the page as it is in the asker's view", async () => {
    document.body.innerHTML = `<input id="name" aria-label="Name">`
    await backend.run(MOCKUP, {
      op: "type",
      target: { selector: "#name" },
      text: "Ada",
    })
    rendered.length = 0
    const shot = await backend.screenshot(MOCKUP)
    expect(shot.status).toBe("shot")
    expect(rendered[0]?.markup).toContain('value="Ada"')
    expect(snapshotDocument(rendered[0]!)).toMatch(
      /Content-Security-Policy[\s\S]*value="Ada"[\s\S]*scrollTo\(0, 0\)/
    )
  })

  it("says it can't drive a frame here, nor something that isn't there", async () => {
    expect(await backend.unavailable(FRAME)).toMatch(/only Mockups/)
    expect(await backend.unavailable("nope")).toMatch(/no Mockup nope/)
    expect(await backend.unavailable()).toBeNull()
  })

  it("gives up when the asker's canvas isn't open, and clears the ask", async () => {
    const away = backendFor("cy", 50)
    const result = await away.run(MOCKUP, {
      op: "click",
      target: { text: "Save" },
    })
    expect(result).toMatchObject({ status: "unavailable" })
    expect(result.status === "unavailable" && result.reason).toMatch(
      /open in their browser/
    )
    expect(c.frameDriveAsks.toMap().size).toBe(0)
  })
})

describe("docRelaySocket", () => {
  it("clears a stale ask instead of running it", async () => {
    const doc = new Y.Doc()
    const asks = createRoomCollections(doc).frameDriveAsks
    asks.set("old", {
      viewer: ADA,
      message: { type: "where", id: "old", frameId: MOCKUP },
      at: 0,
    })
    const got: unknown[] = []
    const socket = docRelaySocket({
      asks: {
        entries: () => asks.toMap(),
        delete: (id) => asks.delete(id),
        observe: (listener) => asks.observe(listener),
      },
      viewerId: ADA,
      post: async () => {},
      now: () => FRAME_DRIVE_ASK_TTL_MS + 1,
    })
    socket.addEventListener("message", (event) => got.push(event.data))
    await new Promise((r) => setTimeout(r, 0))
    expect(got).toEqual([])
    expect(asks.has("old")).toBe(false)
    socket.close()
  })

  it("brings a Mockup or a shared frame into the asker's view only, for showing (#1390, #1396)", async () => {
    expect(await backend.reveal(MOCKUP)).toBeNull()
    expect(await backend.reveal(FRAME)).toBeNull()
    expect(revealed[ADA]).toEqual([MOCKUP, FRAME])
    expect(revealed[BEN]).toEqual([])
    expect(await backend.reveal("nope")).toMatch(/no Mockup nope/)
  })
})
