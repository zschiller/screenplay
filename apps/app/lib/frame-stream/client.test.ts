import { describe, expect, it, vi } from "vitest"

import {
  FrameStreamConnection,
  type FrameStreamEndpoint,
  type FrameStreamHandlers,
} from "@/lib/frame-stream/client"
import {
  decodeVideoMessage,
  h264CodecOf,
  type FrameStreamClientMessage,
} from "@/lib/frame-stream/protocol"

class FakeSocket {
  binaryType = ""
  readyState = 0
  sent: FrameStreamClientMessage[] = []
  onopen: ((ev: unknown) => void) | null = null
  onclose: ((ev: unknown) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  constructor(public url: string) {}
  send(data: string) {
    this.sent.push(JSON.parse(data))
  }
  close() {
    this.onclose?.({})
  }
  open() {
    this.onopen?.({})
  }
  serverSays(msg: object) {
    this.onmessage?.({ data: JSON.stringify(msg) })
  }
}

function setup(endpoint: FrameStreamEndpoint) {
  const sockets: FakeSocket[] = []
  const timers: (() => void)[] = []
  const conn = new FrameStreamConnection({
    fetchEndpoint: async () => endpoint,
    openSocket: (url) => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s
    },
    setTimeout: (fn) => timers.push(fn),
    clearTimeout: () => {},
  })
  return { conn, sockets, timers }
}

function handlers() {
  return {
    onMessage: vi.fn<FrameStreamHandlers["onMessage"]>(),
    onVideo: vi.fn<FrameStreamHandlers["onVideo"]>(),
  }
}

const flush = () => new Promise((r) => setTimeout(r, 0))

function videoMessage(frame: string, key: boolean, payload: number[]) {
  const id = new TextEncoder().encode(frame)
  return new Uint8Array([1, key ? 1 : 0, 0, id.length, ...id, ...payload])
    .buffer
}

describe("FrameStreamConnection", () => {
  it("keeps a Workspace's frames per viewer when the app says they aren't shared", async () => {
    const { conn, sockets } = setup({ shared: false })
    conn.check()
    await flush()
    expect(conn.availability).toBe("unshared")
    expect(sockets).toHaveLength(0)
  })

  it("falls back to per-viewer frames when the app can't set up the stream", async () => {
    const timers: (() => void)[] = []
    const conn = new FrameStreamConnection({
      fetchEndpoint: async () => {
        throw new Error("502")
      },
      openSocket: () => {
        throw new Error("never opened")
      },
      setTimeout: (fn) => timers.push(fn),
      clearTimeout: () => {},
    })
    conn.check()
    for (let i = 0; i < 3; i++) {
      await flush()
      expect(conn.availability).toBe("checking")
      timers.shift()!()
    }
    await flush()
    expect(conn.availability).toBe("unshared")
    expect(timers).toHaveLength(0)
  })

  it("authenticates first, then watches every frame asked for", async () => {
    const { conn, sockets } = setup({
      shared: true,
      url: "wss://s",
      token: "t",
    })
    conn.watch("f1", { route: "/", width: 640, height: 400 }, handlers())
    await flush()
    expect(conn.availability).toBe("shared")
    const socket = sockets[0]!
    socket.open()
    expect(socket.sent).toEqual([{ t: "auth", token: "t" }])

    socket.serverSays({ t: "ready", codec: "h264" })
    expect(socket.sent.at(-1)).toEqual({
      t: "watch",
      frame: "f1",
      route: "/",
      width: 640,
      height: 400,
    })
  })

  it("reaches a watched frame's bridge over the stream, and hears only its own", async () => {
    const { conn, sockets } = setup({
      shared: true,
      url: "wss://s",
      token: "t",
    })
    const port = conn.bridgePort("f1")
    const heard = vi.fn()
    const off = port.subscribe(heard)
    const query = {
      type: "screenplay:dom-query",
      id: "q1",
      op: "getDocumentSize",
    } as const
    // Not watched: the service would drop it, so it isn't sent.
    expect(port.post(query)).toBe(false)

    conn.watch("f1", { route: "/", width: 10, height: 10 }, handlers())
    await flush()
    const socket = sockets[0]!
    socket.open()
    socket.serverSays({ t: "ready", codec: "h264" })
    expect(port.post(query)).toBe(true)
    expect(socket.sent.at(-1)).toEqual({
      t: "bridge",
      frame: "f1",
      message: query,
    })

    const answer = {
      type: "screenplay:dom-result",
      id: "q1",
      ok: true,
      value: { width: 1, height: 2 },
    }
    socket.serverSays({ t: "bridge", frame: "f2", message: answer })
    socket.serverSays({ t: "bridge", frame: "f1", message: answer })
    expect(heard.mock.calls).toEqual([[answer]])
    off()
    socket.serverSays({ t: "bridge", frame: "f1", message: answer })
    expect(heard).toHaveBeenCalledTimes(1)
  })

  it("hands each frame its own video and messages", async () => {
    const { conn, sockets } = setup({
      shared: true,
      url: "wss://s",
      token: "t",
    })
    const one = handlers()
    const two = handlers()
    conn.watch("f1", { route: "/", width: 10, height: 10 }, one)
    conn.watch("f2", { route: "/", width: 10, height: 10 }, two)
    await flush()
    const socket = sockets[0]!
    socket.open()
    socket.serverSays({ t: "ready", codec: "h264" })

    socket.onmessage?.({ data: videoMessage("f2", true, [7, 8]) })
    socket.serverSays({ t: "route", frame: "f1", path: "/next" })

    expect(one.onVideo).not.toHaveBeenCalled()
    expect(two.onVideo.mock.calls[0]![0]).toMatchObject({
      frame: "f2",
      key: true,
    })
    expect(Array.from(two.onVideo.mock.calls[0]![0].data)).toEqual([7, 8])
    expect(one.onMessage).toHaveBeenCalledWith({
      t: "route",
      frame: "f1",
      path: "/next",
    })
  })

  it("sends a new size and the room's route as they change", async () => {
    const { conn, sockets } = setup({
      shared: true,
      url: "wss://s",
      token: "t",
    })
    conn.watch("f1", { route: "/", width: 10, height: 10 }, handlers())
    await flush()
    const socket = sockets[0]!
    socket.open()
    socket.serverSays({ t: "ready", codec: "h264" })

    conn.update("f1", { width: 20, height: 10 })
    conn.update("f1", { route: "/b" })
    conn.update("f1", { route: "/b" })
    expect(socket.sent.slice(2)).toEqual([
      { t: "size", frame: "f1", width: 20, height: 10 },
      { t: "navigate", frame: "f1", route: "/b" },
    ])
  })

  it("reconnects and watches again at the current route", async () => {
    const { conn, sockets, timers } = setup({
      shared: true,
      url: "wss://s",
      token: "t",
    })
    const h = { ...handlers(), onConnection: vi.fn() }
    conn.watch("f1", { route: "/", width: 10, height: 10 }, h)
    await flush()
    sockets[0]!.open()
    sockets[0]!.serverSays({ t: "ready", codec: "h264" })
    conn.update("f1", { route: "/later" })

    // The Sandbox hibernated: the stream drops.
    sockets[0]!.close()
    expect(h.onConnection).toHaveBeenLastCalledWith(false)
    expect(conn.send({ t: "reload", frame: "f1" })).toBe(false)

    timers.shift()!()
    await flush()
    const next = sockets[1]!
    next.open()
    next.serverSays({ t: "ready", codec: "h264" })
    expect(next.sent).toEqual([
      { t: "auth", token: "t" },
      { t: "watch", frame: "f1", route: "/later", width: 10, height: 10 },
    ])
    expect(h.onConnection).toHaveBeenLastCalledWith(true)
  })

  it("stops watching a frame once its last view goes", async () => {
    const { conn, sockets } = setup({
      shared: true,
      url: "wss://s",
      token: "t",
    })
    const stopA = conn.watch(
      "f1",
      { route: "/", width: 10, height: 10 },
      handlers()
    )
    const stopB = conn.watch(
      "f1",
      { route: "/", width: 10, height: 10 },
      handlers()
    )
    await flush()
    sockets[0]!.open()
    sockets[0]!.serverSays({ t: "ready", codec: "h264" })

    stopA()
    expect(sockets[0]!.sent.at(-1)?.t).toBe("watch")
    stopB()
    expect(sockets[0]!.sent.at(-1)).toEqual({ t: "unwatch", frame: "f1" })
  })
})

describe("going local (#1397)", () => {
  async function connected() {
    const setupResult = setup({ shared: true, url: "wss://s", token: "t" })
    setupResult.conn.check()
    await flush()
    const socket = setupResult.sockets[0]!
    socket.open()
    socket.serverSays({ t: "ready", codec: "h264" })
    return { ...setupResult, socket }
  }

  it("reads the shared page's path, cookies and storage", async () => {
    const { conn, socket } = await connected()
    const pending = conn.snapshot("f1")
    const asked = socket.sent.at(-1)
    expect(asked).toMatchObject({ t: "snapshot", frame: "f1" })
    const id = (asked as { id: string }).id
    socket.serverSays({
      t: "snapshot",
      frame: "f1",
      id,
      path: "/cart?step=2",
      cookies: [
        {
          name: "session",
          value: "s",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
        },
      ],
      localStorage: [["draft", "hello"]],
    })
    expect(await pending).toEqual({
      path: "/cart?step=2",
      cookies: [
        {
          name: "session",
          value: "s",
          path: "/",
          expires: -1,
          httpOnly: true,
          secure: false,
        },
      ],
      localStorage: [["draft", "hello"]],
    })
  })

  it("answers null when the page can't be read, the stream drops or it times out", async () => {
    const { conn, socket } = await connected()
    const refused = conn.snapshot("f1")
    const id = (socket.sent.at(-1) as { id: string }).id
    socket.serverSays({ t: "snapshot", frame: "f1", id, error: "not live" })
    expect(await refused).toBeNull()

    const dropped = conn.snapshot("f1")
    socket.close()
    expect(await dropped).toBeNull()
    // Disconnected: nothing to ask.
    expect(await conn.snapshot("f1")).toBeNull()

    const { conn: slowConn, timers: slowTimers } = await connected()
    const slow = slowConn.snapshot("f1")
    slowTimers.at(-1)!()
    expect(await slow).toBeNull()
  })
})

describe("frame stream protocol", () => {
  it("decodes a video message's frame, keyframe flag and payload", () => {
    const video = decodeVideoMessage(
      new Uint8Array(videoMessage("abc", false, [1, 2, 3]))
    )
    expect(video).toMatchObject({ frame: "abc", key: false })
    expect(Array.from(video!.data)).toEqual([1, 2, 3])
    expect(decodeVideoMessage(new Uint8Array([2, 0, 0, 0]))).toBeNull()
  })

  it("reads the H.264 codec string from a keyframe's SPS", () => {
    // AUD, then an SPS for Constrained Baseline (0x42, 0xc0) level 4.2 (0x2a).
    const au = new Uint8Array([
      0, 0, 0, 1, 9, 0xf0, 0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x2a, 0x8c,
    ])
    expect(h264CodecOf(au)).toBe("avc1.42c02a")
    expect(h264CodecOf(new Uint8Array([0, 0, 0, 1, 0x41, 1, 2, 3]))).toBeNull()
  })
})
