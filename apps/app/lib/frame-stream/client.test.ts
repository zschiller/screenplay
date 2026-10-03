import { describe, expect, it, vi } from "vitest"

import {
  FrameStreamConnection,
  type FrameStreamEndpoint,
  type FrameStreamHandlers,
} from "@/lib/frame-stream/client"
import {
  clickCounter,
  decodeVideoMessage,
  h264CodecOf,
  pageKeyOf,
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

type Timer = (() => void) & { ms: number; cleared?: boolean }

function setup(
  endpoint: FrameStreamEndpoint,
  driveTokens: (string | null)[] = []
) {
  const sockets: FakeSocket[] = []
  const timers: Timer[] = []
  const visible = new Set<() => void>()
  const fetchDriveToken = vi.fn(async (_frame: string) =>
    driveTokens.length ? driveTokens.shift()! : null
  )
  const conn = new FrameStreamConnection({
    fetchEndpoint: async () => endpoint,
    fetchDriveToken,
    onVisible: (listener) => {
      visible.add(listener)
      return () => visible.delete(listener)
    },
    openSocket: (url) => {
      const s = new FakeSocket(url)
      sockets.push(s)
      return s
    },
    setTimeout: (fn, ms) => {
      const timer: Timer = Object.assign(() => fn(), { ms })
      timers.push(timer)
      return timer
    },
    clearTimeout: (id) => {
      if (id) (id as Timer).cleared = true
    },
  })
  const showTab = () => visible.forEach((l) => l())
  return { conn, sockets, timers, fetchDriveToken, showTab }
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
      fetchDriveToken: async () => null,
      onVisible: () => () => {},
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
    expect(conn.frame("f1").reload()).toBe(false)

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

describe("driving", () => {
  const watch = { route: "/", width: 10, height: 10 }

  async function watching(tokens: (string | null)[]) {
    const setupResult = setup(
      { shared: true, url: "wss://s", token: "t" },
      tokens
    )
    const frame = setupResult.conn.frame("f1")
    const stop = frame.watch(watch, handlers())
    await flush()
    const socket = setupResult.sockets[0]!
    socket.open()
    socket.serverSays({ t: "ready", codec: "h264" })
    // Runs the first live timer that waits `ms`.
    const fire = async (ms: number) => {
      const i = setupResult.timers.findIndex((t) => t.ms === ms && !t.cleared)
      if (i < 0) throw new Error(`no ${ms} ms timer`)
      setupResult.timers.splice(i, 1)[0]!()
      await flush()
    }
    return { ...setupResult, frame, stop, socket, fire }
  }

  it("asks the app for a grant and sends it, and releases when it stops", async () => {
    const { frame, socket, fetchDriveToken } = await watching(["g"])
    const stopDriving = frame.drive()
    await flush()
    expect(fetchDriveToken).toHaveBeenCalledWith("f1")
    expect(socket.sent.at(-1)).toEqual({ t: "drive", frame: "f1", token: "g" })

    stopDriving()
    expect(socket.sent.at(-1)).toEqual({ t: "release", frame: "f1" })
  })

  it("asks again when the app refuses at first", async () => {
    const { frame, socket, fire } = await watching([null, "g"])
    frame.drive()
    await flush()
    expect(socket.sent.some((m) => m.t === "drive")).toBe(false)
    await fire(300)
    expect(socket.sent.at(-1)).toEqual({ t: "drive", frame: "f1", token: "g" })
  })

  it("refreshes the grant before it expires, and stops once released", async () => {
    const { frame, socket, timers, fire, fetchDriveToken } = await watching([
      "g",
      "g2",
    ])
    const stopDriving = frame.drive()
    await flush()
    await fire(30_000)
    expect(socket.sent.at(-1)).toEqual({ t: "drive", frame: "f1", token: "g2" })

    stopDriving()
    expect(timers.filter((t) => t.ms === 30_000 && !t.cleared)).toEqual([])
    expect(fetchDriveToken).toHaveBeenCalledTimes(2)
  })

  it("waits for the stream before asking", async () => {
    const { conn, sockets, fetchDriveToken } = setup(
      { shared: true, url: "wss://s", token: "t" },
      ["g"]
    )
    const frame = conn.frame("f1")
    frame.watch(watch, handlers())
    frame.drive()
    await flush()
    expect(fetchDriveToken).not.toHaveBeenCalled()

    sockets[0]!.open()
    sockets[0]!.serverSays({ t: "ready", codec: "h264" })
    await flush()
    expect(sockets[0]!.sent.slice(-2)).toEqual([
      { t: "watch", frame: "f1", ...watch },
      { t: "drive", frame: "f1", token: "g" },
    ])
  })

  it("sends the grant again whenever it watches the frame again, and asks for a new one after a reconnect or when the tab shows", async () => {
    const watched = await watching(["g", "g2", "g3"])
    const { frame, socket, sockets, fire, showTab } = watched
    let stop = watched.stop
    const stopDriving = frame.drive()
    await flush()
    expect(socket.sent.at(-1)).toEqual({ t: "drive", frame: "f1", token: "g" })
    stop()

    // The tab hid: the service forgets a driver who stops watching, so
    // watching again carries the grant.
    stop = frame.watch(watch, handlers())
    expect(socket.sent.at(-1)).toEqual({ t: "drive", frame: "f1", token: "g" })

    // A reconnect re-sends it, then asks for a fresh one.
    socket.close()
    await fire(500)
    const next = sockets[1]!
    next.open()
    next.serverSays({ t: "ready", codec: "h264" })
    await flush()
    expect(next.sent).toEqual([
      { t: "auth", token: "t" },
      { t: "watch", frame: "f1", ...watch },
      { t: "drive", frame: "f1", token: "g" },
      { t: "drive", frame: "f1", token: "g2" },
    ])

    showTab()
    await flush()
    expect(next.sent.at(-1)).toEqual({ t: "drive", frame: "f1", token: "g3" })

    // Released, it goes back to watching only.
    stopDriving()
    expect(next.sent.at(-1)).toEqual({ t: "release", frame: "f1" })
    stop()
    frame.watch(watch, handlers())
    expect(next.sent.at(-1)).toEqual({ t: "watch", frame: "f1", ...watch })
  })

  it("holds a grant for a frame it isn't watching until it watches it", async () => {
    const { conn, socket, stop } = await watching(["g"])
    stop()
    const other = conn.frame("f2")
    other.drive()
    await flush()
    expect(socket.sent.some((m) => m.t === "drive")).toBe(false)
    other.watch(watch, handlers())
    expect(socket.sent.slice(-2)).toEqual([
      { t: "watch", frame: "f2", ...watch },
      { t: "drive", frame: "f2", token: "g" },
    ])
  })

  it("reloads the shared page", async () => {
    const { frame, socket } = await watching([])
    expect(frame.reload()).toBe(true)
    expect(socket.sent.at(-1)).toEqual({ t: "reload", frame: "f1" })
  })
})

describe("driver input", () => {
  async function driving(mac = false) {
    const setupResult = setup({ shared: true, url: "wss://s", token: "t" })
    const frame = setupResult.conn.frame("f1")
    frame.watch({ route: "/", width: 400, height: 300 }, handlers())
    await flush()
    const socket = setupResult.sockets[0]!
    socket.open()
    socket.serverSays({ t: "ready", codec: "h264" })
    // The picture of a 400×300 page, drawn at half size at (100, 50).
    const input = frame.input(
      () => ({
        rect: { left: 100, top: 50, width: 200, height: 150 },
        width: 400,
        height: 300,
      }),
      { mac }
    )
    const sent = () => {
      const last = socket.sent.at(-1)
      return last?.t === "input" ? last : undefined
    }
    return { input, socket, sent }
  }

  const mods = {
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
  }
  const cancelable = () => ({
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
  })
  const key = (
    k: string,
    more: Partial<typeof mods & { code: string }> = {}
  ) => ({
    ...mods,
    ...cancelable(),
    key: k,
    code: k.length === 1 ? `Key${k.toUpperCase()}` : k,
    keyCode: 0,
    repeat: false,
    isComposing: false,
    ...more,
  })

  it("scales pointer positions to the page and counts clicks", async () => {
    const { input, sent } = await driving()
    const at = { ...mods, button: 0, buttons: 1, clientX: 150, clientY: 100 }
    input.pointer("mousePressed", { ...at, timeStamp: 0 })
    expect(sent()).toMatchObject({
      kind: "mouse",
      type: "mousePressed",
      x: 100,
      y: 100,
      button: "left",
      clickCount: 1,
    })
    input.pointer("mouseReleased", { ...at, buttons: 0, timeStamp: 50 })
    input.pointer("mousePressed", { ...at, timeStamp: 100 })
    expect(sent()).toMatchObject({ clickCount: 2 })
    input.pointer("mouseMoved", { ...at, timeStamp: 150 })
    expect(sent()).toMatchObject({ button: "none", clickCount: 0 })
  })

  it("scrolls the page, but leaves Cmd/Ctrl+wheel to zoom the canvas", async () => {
    const { input, socket, sent } = await driving()
    const wheel = {
      ...mods,
      ...cancelable(),
      clientX: 300,
      clientY: 200,
      deltaX: 0,
      deltaY: 40,
    }
    input.wheel(wheel)
    expect(sent()).toMatchObject({ kind: "wheel", x: 400, y: 300, deltaY: 40 })
    expect(wheel.preventDefault).toHaveBeenCalled()

    const zoom = { ...wheel, ...cancelable(), ctrlKey: true }
    const before = socket.sent.length
    input.wheel(zoom)
    expect(socket.sent).toHaveLength(before)
    expect(zoom.preventDefault).not.toHaveBeenCalled()
  })

  it("sends characters as text, Enter as a return and other keys raw", async () => {
    const { input, sent } = await driving()
    const a = key("a")
    input.key("keyDown", a)
    expect(sent()).toMatchObject({ kind: "key", type: "keyDown", text: "a" })
    expect(a.preventDefault).toHaveBeenCalled()
    expect(a.stopPropagation).toHaveBeenCalled()

    input.key("keyDown", key("Enter"))
    expect(sent()).toMatchObject({ type: "keyDown", text: "\r" })
    input.key("keyDown", key("ArrowLeft"))
    expect(sent()).toMatchObject({ type: "rawKeyDown" })
    expect(sent()).not.toHaveProperty("text")
    input.key("keyUp", key("a"))
    expect(sent()).toMatchObject({ type: "keyUp" })
    expect(sent()).not.toHaveProperty("text")
    // A shortcut sends no text.
    input.key("keyDown", key("z", { ctrlKey: true }))
    expect(sent()).toMatchObject({ type: "rawKeyDown", modifiers: 2 })
  })

  it("maps a Mac viewer's shortcuts", async () => {
    const { input, sent } = await driving(true)
    input.key("keyDown", key("ArrowLeft", { metaKey: true }))
    expect(sent()).toMatchObject({ key: "Home", modifiers: 0 })
  })

  it("lets Escape reach the canvas too", async () => {
    const { input, sent } = await driving()
    const esc = key("Escape")
    input.key("keyDown", esc)
    expect(sent()).toMatchObject({ key: "Escape", type: "rawKeyDown" })
    expect(esc.preventDefault).not.toHaveBeenCalled()
    expect(esc.stopPropagation).not.toHaveBeenCalled()
  })

  it("leaves copy, cut and paste shortcuts to their clipboard events", async () => {
    const { input, socket } = await driving()
    const before = socket.sent.length
    for (const code of ["KeyC", "KeyX", "KeyV"]) {
      const e = key(code.at(-1)!.toLowerCase(), { metaKey: true, code })
      input.key("keyDown", e)
      expect(e.preventDefault).not.toHaveBeenCalled()
      expect(e.stopPropagation).toHaveBeenCalled()
    }
    expect(socket.sent).toHaveLength(before)
  })

  it("skips keys mid-composition", async () => {
    const { input, socket } = await driving()
    const before = socket.sent.length
    input.key("keyDown", { ...key("a"), isComposing: true })
    expect(socket.sent).toHaveLength(before)
  })

  it("pastes this viewer's clipboard as text and copies out", async () => {
    const { input, socket, sent } = await driving()
    const paste = {
      type: "paste",
      preventDefault: vi.fn(),
      clipboardData: { getData: () => "hello" },
    }
    input.paste(paste)
    expect(sent()).toEqual({
      t: "input",
      frame: "f1",
      kind: "text",
      text: "hello",
    })
    expect(paste.preventDefault).toHaveBeenCalled()

    const cut = { type: "cut", preventDefault: vi.fn(), clipboardData: null }
    const copied = input.copy(cut)
    expect(cut.preventDefault).toHaveBeenCalled()
    const asked = socket.sent.at(-1)
    expect(asked).toMatchObject({ t: "clipboard", frame: "f1", cut: true })
    if (asked?.t !== "clipboard") throw new Error("not asked")
    socket.serverSays({ t: "clipboard", frame: "f1", id: asked.id, text: "x" })
    expect(await copied).toBe("x")
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

describe("copying out", () => {
  it("answers with what the page copied, and null when the stream drops", async () => {
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

    const copied = conn.clipboard("f1", true)
    const asked = socket.sent.at(-1)
    expect(asked).toMatchObject({ t: "clipboard", frame: "f1", cut: true })
    if (asked?.t !== "clipboard") throw new Error("not asked")
    socket.serverSays({ t: "clipboard", frame: "f1", id: asked.id, text: "hi" })
    expect(await copied).toBe("hi")

    const dropped = conn.clipboard("f1", false)
    socket.close()
    expect(await dropped).toBeNull()
  })
})

describe("frame stream input", () => {
  it("counts quick presses in one place as double and triple clicks", () => {
    const count = clickCounter()
    expect(count(0, 10, 10, 0)).toBe(1)
    expect(count(0, 11, 10, 200)).toBe(2)
    expect(count(0, 11, 11, 400)).toBe(3)
    // Too slow, too far, or another button starts again.
    expect(count(0, 11, 11, 1000)).toBe(1)
    expect(count(0, 30, 11, 1100)).toBe(1)
    expect(count(2, 30, 11, 1200)).toBe(1)
  })

  const press = (
    key: string,
    mods: Partial<
      Record<"altKey" | "ctrlKey" | "metaKey" | "shiftKey", boolean>
    > = {}
  ) => ({
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    keyCode: key.length === 1 ? key.toUpperCase().charCodeAt(0) : 0,
    altKey: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  })

  it("sends a Mac viewer's shortcuts as the shared browser's Linux ones", () => {
    // ⌘A selects all as Ctrl+A.
    expect(pageKeyOf(press("a", { metaKey: true }), true)).toMatchObject({
      key: "a",
      modifiers: 2,
    })
    // ⌘⇧← selects to the line's start.
    expect(
      pageKeyOf(press("ArrowLeft", { metaKey: true, shiftKey: true }), true)
    ).toEqual({ key: "Home", code: "Home", keyCode: 36, modifiers: 8 })
    expect(pageKeyOf(press("ArrowDown", { metaKey: true }), true)).toEqual({
      key: "End",
      code: "End",
      keyCode: 35,
      modifiers: 2,
    })
    // ⌥⌫ deletes a word, as Ctrl+Backspace.
    expect(pageKeyOf(press("Backspace", { altKey: true }), true)).toMatchObject(
      { key: "Backspace", modifiers: 2 }
    )
    // Elsewhere, keys go as they are.
    expect(pageKeyOf(press("a", { metaKey: true }), false)).toMatchObject({
      modifiers: 4,
    })
    expect(pageKeyOf(press("b", { ctrlKey: true }), true)).toMatchObject({
      modifiers: 2,
    })
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
