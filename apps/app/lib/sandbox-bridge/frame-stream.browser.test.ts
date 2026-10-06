import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import WebSocket from "ws"

import {
  decodeVideoMessage,
  h264CodecOf,
  type FrameStreamClientMessage,
  type FrameStreamServerMessage,
} from "@/lib/frame-stream/protocol"
import { driveToken, viewToken } from "@/lib/frame-stream/token"
import type { IframeToCanvasMessage } from "@/lib/postmessage-protocol"
import { mockupSrcDoc } from "@/lib/yjs/mockup-html"
import { BRIDGE_JS, MOCKUP_RUNTIME_JS } from "./index"

// The Frame Stream service end to end (#1392, #1393), in the style of the
// #1366 prototype's bench: a real Xvfb, Chromium and ffmpeg behind the
// service's WebSocket, a stand-in dev server, and viewers that speak the wire
// protocol. Skipped where the browser stack isn't installed. CI runs it in its
// own job (the *.browser.test.ts files), apart from the sharded unit tests.

const SCRIPT = fileURLToPath(new URL("./frame-stream.mjs", import.meta.url))

function which(cmd: string): string | null {
  try {
    return (
      execFileSync("sh", ["-c", `command -v ${cmd}`])
        .toString()
        .trim() || null
    )
  } catch {
    return null
  }
}

const CHROME =
  process.env.CHROME ??
  which("google-chrome") ??
  which("chromium") ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : null)
const HAS_STACK =
  process.platform === "linux" &&
  !!CHROME &&
  !!which("Xvfb") &&
  !!which("ffmpeg") &&
  !!which("xte")
// CI's browser job installs the stack; there a missing piece is a failure,
// not a skip, so the test can't drop out of CI unnoticed.
if (process.env.SCREENPLAY_REQUIRE_BROWSER_STACK && !HAS_STACK) {
  throw new Error("Chrome, Xvfb, ffmpeg and xte are required but not all found")
}

const KEY = "test-stream-key"

// Left half: a link to /next. Right half: a link to /other.
const PAGE = (path: string) => `<!doctype html><html><head><style>
  body { margin: 0 }
  a { position: fixed; top: 0; bottom: 0; width: 50%; }
  #next { left: 0; background: #cde } #other { right: 0; background: #edc }
</style></head><body data-path="${path}">
  <a id="next" href="/next">next</a><a id="other" href="/other">other</a>
</body></html>`

// A page with the Sandbox Bridge, as the proxy serves it, and a stand-in for
// the Knobs package: it declares a colour knob to its parent and shows the
// value it's sent. It also tries the host's way out directly, which the
// service must not take from the app.
const BRIDGE_PAGE = `<!doctype html><html><head><script>${BRIDGE_JS}</script>
<style>body { margin: 0 } #tall { width: 900px; height: 1200px }</style>
</head><body><div id="tall"><button id="pay">Pay</button></div><script>
  parent.postMessage({ type: "screenplay:knobs-declared", knobs: [
    { id: "color", type: "string", label: "Colour", default: "blue" },
  ] }, "*")
  try {
    __screenplayFrameHost(JSON.stringify({ type: "screenplay:knobs-declared", knobs: [{ id: "forged" }] }))
  } catch {}
  addEventListener("message", (e) => {
    if (e.data && e.data.type === "screenplay:knob-values")
      document.body.dataset.color = e.data.values.color
  })
</script></body></html>`

type BridgeMessage = Extract<FrameStreamServerMessage, { t: "bridge" }>

// A page with in-memory state: each click counts, repaints, sets a session
// cookie and both storages, and reports the count. On load it reports what
// its storage held.
const APP = `<!doctype html><html><body style="margin:0;background:#cde">
<button id="b" style="position:fixed;inset:0;opacity:0">count</button>
<script>
  let count = 0
  fetch("/report?" + new URLSearchParams({
    local: localStorage.getItem("k") ?? "",
    session: sessionStorage.getItem("k") ?? "",
  }))
  document.getElementById("b").onclick = () => {
    count++
    document.body.style.background = count % 2 ? "#c33" : "#3c3"
    document.cookie = "c=" + count
    localStorage.setItem("k", "local" + count)
    sessionStorage.setItem("k", "session" + count)
    fetch("/count?n=" + count)
  }
</script></body></html>`

// A field with its text selected, which reports what's left in it. With
// ?handled the page's copy handler puts its own text on the clipboard.
const COPY = `<!doctype html><body>
<input id="i" value="hello world"><script>
  const i = document.getElementById("i")
  i.focus()
  i.select()
  i.addEventListener("input", () => fetch("/left?v=" + encodeURIComponent(i.value)))
  if (location.search === "?handled")
    document.addEventListener("copy", (e) => {
      e.clipboardData.setData("text/plain", "from the page")
      e.preventDefault()
    })
</script></body>`

// A native select, whose popup only real X input reaches. It reports what's
// picked.
const SELECT = `<!doctype html><body style="margin:0">
<select id="s" style="position:absolute;left:20px;top:20px;font-size:20px">
<option>one</option><option>two</option><option>three</option></select>
<script>
  const s = document.getElementById("s")
  s.onchange = () => fetch("/picked?v=" + s.value)
</script></body>`

// The paused frame's grace period and the browser cap, short and small.
const IDLE_MS = 500
const MAX_FRAMES = 2

type Viewer = {
  ws: WebSocket
  messages: FrameStreamServerMessage[]
  videos: { frame: string; key: boolean; data: Uint8Array }[]
  send(msg: FrameStreamClientMessage): void
  waitFor<T>(pick: () => T | undefined, timeout?: number): Promise<T>
}

/** How long the run's first browser may take to start. */
const FIRST_START_MS = 60_000

async function waitUntil<T>(
  pick: () => T | undefined,
  timeout = 20_000
): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = pick()
    if (value !== undefined && value !== false) return value
    if (Date.now() - start > timeout) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe.skipIf(!HAS_STACK)("frame stream service", () => {
  let devServer: http.Server
  let service: ChildProcess
  let port = 0
  let origin = ""
  const requests: string[] = []
  const cookies: string[] = []
  const viewers: Viewer[] = []
  let serviceLog = ""

  async function connect(userId: string): Promise<Viewer> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`)
    const viewer: Viewer = {
      ws,
      messages: [],
      videos: [],
      send: (msg) => ws.send(JSON.stringify(msg)),
      waitFor: (pick, timeout) => waitUntil(pick, timeout),
    }
    ws.on("message", (data, isBinary) => {
      if (isBinary) {
        const video = decodeVideoMessage(new Uint8Array(data as Buffer))
        if (video) viewer.videos.push(video)
      } else {
        viewer.messages.push(JSON.parse(String(data)))
      }
    })
    await new Promise((r) => ws.once("open", r))
    viewer.send({ t: "auth", token: viewToken(KEY, userId).token })
    await viewer.waitFor(() => viewer.messages.find((m) => m.t === "ready"))
    viewers.push(viewer)
    return viewer
  }

  const bridgeOf = (v: Viewer, frame: string) =>
    v.messages
      .filter((m): m is BridgeMessage => m.t === "bridge" && m.frame === frame)
      .map((m) => m.message)

  /** A read through the shared page's bridge, answered to this viewer. */
  async function read(
    v: Viewer,
    frame: string,
    id: string,
    query: Record<string, unknown>
  ) {
    v.send({
      t: "bridge",
      frame,
      message: { type: "screenplay:dom-query", id, ...query },
    } as FrameStreamClientMessage)
    const answer = await v.waitFor(() =>
      bridgeOf(v, frame).find(
        (
          m
        ): m is Extract<
          IframeToCanvasMessage,
          { type: "screenplay:dom-result" }
        > => m.type === "screenplay:dom-result" && m.id === id
      )
    )
    if (!answer.ok) throw new Error(answer.error)
    return answer.value
  }

  /** A left click. Chrome ignores clicks on an iframe that has only just
   *  appeared (the host's, as a browser starts), so it clicks until `done`. */
  async function clickUntil(
    v: Viewer,
    frame: string,
    x: number,
    y: number,
    done: () => boolean
  ) {
    for (let i = 0; i < 20 && !done(); i++) {
      for (const type of ["mousePressed", "mouseReleased"] as const) {
        v.send({
          t: "input",
          frame,
          kind: "mouse",
          type,
          x,
          y,
          button: "left",
          buttons: type === "mousePressed" ? 1 : 0,
          clickCount: 1,
          modifiers: 0,
        })
      }
      const start = Date.now()
      while (!done() && Date.now() - start < 500)
        await new Promise((r) => setTimeout(r, 25))
    }
  }

  type RouteMessage = Extract<FrameStreamServerMessage, { t: "route" }>
  const routeOf = (v: Viewer, frame: string) =>
    v.messages
      .filter((m): m is RouteMessage => m.t === "route" && m.frame === frame)
      .at(-1)

  beforeAll(async () => {
    devServer = http.createServer((req, res) => {
      const url = req.url ?? "/"
      requests.push(url)
      cookies.push(req.headers.cookie ?? "")
      // A page that keeps state in a cookie (HttpOnly too) and local storage.
      if (url === "/store") {
        res.writeHead(200, {
          "content-type": "text/html",
          "set-cookie": [
            "session=s3cret; Path=/; HttpOnly; SameSite=Lax",
            "theme=dark; Path=/",
          ],
        })
        res.end(
          `<!doctype html><script>localStorage.setItem("draft", "hello")</script>`
        )
        return
      }
      // A page that notes the colour scheme it matches, live.
      if (url === "/scheme") {
        res.writeHead(200, { "content-type": "text/html" })
        res.end(
          `<!doctype html><script>
            const dark = matchMedia("(prefers-color-scheme: dark)")
            const note = () =>
              localStorage.setItem("scheme", dark.matches ? "dark" : "light")
            note()
            dark.addEventListener("change", note)
          </script>`
        )
        return
      }
      res.writeHead(200, { "content-type": "text/html" })
      res.end(
        url === "/bridge"
          ? BRIDGE_PAGE
          : url === "/app"
            ? APP
            : url.startsWith("/copy")
              ? COPY
              : url === "/select"
                ? SELECT
                : PAGE(url)
      )
    })
    await new Promise<void>((r) => devServer.listen(0, "127.0.0.1", r))
    origin = `http://127.0.0.1:${(devServer.address() as AddressInfo).port}`

    // A free port for the service.
    const probe = http.createServer()
    await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r))
    port = (probe.address() as AddressInfo).port
    await new Promise((r) => probe.close(r))

    service = spawn(process.execPath, [SCRIPT], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        SCREENPLAY_STREAM_PORT: String(port),
        SCREENPLAY_STREAM_HOST: "127.0.0.1",
        SCREENPLAY_STREAM_KEY: KEY,
        SCREENPLAY_FRAME_ORIGIN: origin,
        SCREENPLAY_CHROME: CHROME!,
        SCREENPLAY_STREAM_DISPLAY: String(150 + (process.pid % 50)),
        SCREENPLAY_STREAM_IDLE_MS: String(IDLE_MS),
        SCREENPLAY_STREAM_MAX_FRAMES: String(MAX_FRAMES),
      },
    })
    service.stdout?.on("data", (d) => (serviceLog += String(d)))
    service.stderr?.on("data", (d) => process.stderr.write(d))
  }, 30_000)

  afterAll(async () => {
    for (const v of viewers) v.ws.close()
    service?.kill("SIGTERM")
    await new Promise((r) => devServer?.close(r))
  })

  // Waits for the service to listen, on first use.
  async function ready() {
    const start = Date.now()
    for (;;) {
      try {
        if ((await fetch(`http://127.0.0.1:${port}/health`)).ok) return
      } catch {}
      if (Date.now() - start > 10_000) throw new Error("service never listened")
      await new Promise((r) => setTimeout(r, 50))
    }
  }

  it("refuses a connection without a valid view token", async () => {
    await ready()
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`)
    await new Promise((r) => ws.once("open", r))
    ws.send(
      JSON.stringify({ t: "auth", token: viewToken("wrong-key", "u1").token })
    )
    const code = await new Promise<number>((r) => ws.once("close", r))
    expect(code).toBe(4401)
  }, 20_000)

  it("streams a frame to every viewer, starting at a keyframe", async () => {
    await ready()
    const a = await connect("ana")
    a.send({ t: "watch", frame: "f1", route: "/", width: 640, height: 400 })
    // The first browser of the run starts cold, and slowly on a CI runner.
    const live = await a.waitFor(
      () =>
        a.messages.find(
          (m) => m.t === "frame" && m.frame === "f1" && m.status === "live"
        ),
      FIRST_START_MS
    )
    // Encoded at twice the CSS size.
    expect(live).toMatchObject({
      width: 640,
      height: 400,
      videoWidth: 1280,
      videoHeight: 800,
    })
    const first = await a.waitFor(() => a.videos.find((v) => v.frame === "f1"))
    expect(first.key).toBe(true)
    expect(h264CodecOf(first.data)).toMatch(/^avc1\.42/)
    // It says its colours, matching what viewers' decoders are told.
    const probe = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_streams", "-f", "h264", "-"],
      { input: Buffer.from(first.data) }
    ).toString()
    expect(probe).toContain("color_space=smpte170m")
    expect(probe).toContain("color_range=tv")

    // A viewer who joins mid-stream also starts at a keyframe.
    const b = await connect("ben")
    b.send({ t: "watch", frame: "f1", route: "/", width: 640, height: 400 })
    const joined = await b.waitFor(() => b.videos.find((v) => v.frame === "f1"))
    expect(joined.key).toBe(true)
    expect(routeOf(b, "f1")).toMatchObject({ path: "/" })
  }, 100_000)

  it("applies only the driver's input, and both viewers see where it went", async () => {
    const [a, b] = viewers.slice(-2) as [Viewer, Viewer]
    // Ben has no grant: his click on "other" never reaches the page.
    b.send({
      t: "input",
      frame: "f1",
      kind: "mouse",
      type: "mousePressed",
      x: 500,
      y: 100,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers: 0,
    })
    b.send({
      t: "input",
      frame: "f1",
      kind: "mouse",
      type: "mouseReleased",
      x: 500,
      y: 100,
      button: "left",
      buttons: 0,
      clickCount: 1,
      modifiers: 0,
    })
    // A grant signed for Ana doesn't work for Ben.
    b.send({
      t: "drive",
      frame: "f1",
      token: driveToken(KEY, "ana", "f1").token,
    })
    await b.waitFor(() =>
      b.messages.find((m) => m.t === "error" && m.message === "drive refused")
    )
    b.send({
      t: "input",
      frame: "f1",
      kind: "mouse",
      type: "mousePressed",
      x: 500,
      y: 100,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers: 0,
    })
    b.send({
      t: "input",
      frame: "f1",
      kind: "mouse",
      type: "mouseReleased",
      x: 500,
      y: 100,
      button: "left",
      buttons: 0,
      clickCount: 1,
      modifiers: 0,
    })

    a.send({
      t: "drive",
      frame: "f1",
      token: driveToken(KEY, "ana", "f1").token,
    })
    await clickUntil(
      a,
      "f1",
      100,
      100,
      () => routeOf(a, "f1")?.path === "/next"
    )
    await a.waitFor(() => routeOf(a, "f1")?.path === "/next" || undefined)
    await b.waitFor(() => routeOf(b, "f1")?.path === "/next" || undefined)
    expect(
      [...a.messages, ...b.messages].some(
        (m) => m.t === "route" && m.path === "/other"
      )
    ).toBe(false)
  }, 30_000)

  it("picks from a native select's popup with the driver's mouse", async () => {
    const [a] = viewers.slice(-2) as [Viewer, Viewer]
    a.send({ t: "navigate", frame: "f1", route: "/select" })
    await a.waitFor(() => routeOf(a, "f1")?.path === "/select" || undefined)
    const click = (x: number, y: number) => {
      for (const type of ["mousePressed", "mouseReleased"] as const)
        a.send({
          t: "input",
          frame: "f1",
          kind: "mouse",
          type,
          x,
          y,
          button: "left",
          buttons: type === "mousePressed" ? 1 : 0,
          clickCount: 1,
          modifiers: 0,
        })
    }
    // Open the popup, then click its third option, below the field: each
    // option is about 30px tall. The page may still be loading at first.
    for (let i = 0; i < 20 && !requests.includes("/picked?v=three"); i++) {
      click(40, 32)
      await new Promise((r) => setTimeout(r, 500))
      click(40, 122)
      await new Promise((r) => setTimeout(r, 500))
    }
    expect(requests).toContain("/picked?v=three")
  }, 30_000)

  it("copies and cuts the page's selection for the driver only", async () => {
    const [a, b] = viewers.slice(-2) as [Viewer, Viewer]
    type Clip = Extract<FrameStreamServerMessage, { t: "clipboard" }>
    let seq = 0
    const clip = async (v: Viewer, cut = false) => {
      const id = `c${++seq}`
      v.send({ t: "clipboard", frame: "f1", id, cut })
      return (
        await v.waitFor(() =>
          v.messages.find((m): m is Clip => m.t === "clipboard" && m.id === id)
        )
      ).text
    }
    // The page's script may run just after the route is reported.
    const clipOnce = async (route: string, want: string) => {
      a.send({ t: "navigate", frame: "f1", route })
      await a.waitFor(() => routeOf(a, "f1")?.path === route || undefined)
      let copied: string | null = null
      for (let i = 0; i < 40 && copied !== want; i++) {
        copied = await clip(a)
        if (copied !== want) await new Promise((r) => setTimeout(r, 100))
      }
      return copied
    }
    // The page's copy handler wins over the selection.
    expect(await clipOnce("/copy?handled", "from the page")).toBe(
      "from the page"
    )
    expect(await clipOnce("/copy", "hello world")).toBe("hello world")
    // A watcher gets nothing, and can't cut.
    expect(await clip(b, true)).toBeNull()
    expect(requests).not.toContain("/left?v=")
    // The driver's cut takes the text out of the field.
    expect(await clip(a, true)).toBe("hello world")
    await waitUntil(() => requests.includes("/left?v="))
    // Nothing selected now: nothing to copy.
    expect(await clip(a)).toBeNull()
  }, 30_000)

  it("follows the room's route, and only when it changed", async () => {
    const [a] = viewers.slice(-2) as [Viewer, Viewer]
    a.send({ t: "navigate", frame: "f1", route: "/other?tab=2" })
    await a.waitFor(
      () => routeOf(a, "f1")?.path === "/other?tab=2" || undefined
    )
    // Never another origin.
    a.send({ t: "navigate", frame: "f1", route: "https://example.com/" })
    await new Promise((r) => setTimeout(r, 300))
    expect(routeOf(a, "f1")?.path).toBe("/other?tab=2")
  }, 30_000)

  it("reads the page's URL, cookies and local storage for going local", async () => {
    const [a] = viewers.slice(-2) as [Viewer, Viewer]
    // Another viewer who isn't watching the frame can still take a copy.
    const c = await connect("cy")
    a.send({ t: "navigate", frame: "f1", route: "/store" })
    await a.waitFor(() => routeOf(a, "f1")?.path === "/store" || undefined)
    type Snapshot = Extract<FrameStreamServerMessage, { t: "snapshot" }>
    // The page's script may run just after the route is reported.
    let snapshot: Snapshot | undefined
    for (let i = 0; i < 40 && !snapshot; i++) {
      const id = `s1-${i}`
      c.send({ t: "snapshot", frame: "f1", id })
      const reply = await c.waitFor(() =>
        c.messages.find((m): m is Snapshot => m.t === "snapshot" && m.id === id)
      )
      if ("path" in reply && reply.localStorage.length) snapshot = reply
      else await new Promise((r) => setTimeout(r, 100))
    }
    expect(snapshot).toMatchObject({
      frame: "f1",
      path: "/store",
      localStorage: [["draft", "hello"]],
    })
    if (!snapshot || !("cookies" in snapshot)) throw new Error("no snapshot")
    expect(
      Object.fromEntries(snapshot.cookies.map((k) => [k.name, k]))
    ).toMatchObject({
      session: { value: "s3cret", httpOnly: true, sameSite: "Lax", path: "/" },
      theme: { value: "dark", httpOnly: false, expires: -1 },
    })

    // A frame that doesn't exist says so.
    c.send({ t: "snapshot", frame: "nope", id: "s2" })
    expect(
      await c.waitFor(() =>
        c.messages.find((m) => m.t === "snapshot" && m.id === "s2")
      )
    ).toMatchObject({ error: "no such frame" })
  }, 30_000)

  it("renders the page in the room's colour scheme", async () => {
    const [a] = viewers.slice(-2) as [Viewer, Viewer]
    type Snapshot = Extract<FrameStreamServerMessage, { t: "snapshot" }>
    let n = 0
    // What the page last noted, once it says `want`.
    const schemeIs = async (want: string) => {
      let seen: string | undefined
      for (let i = 0; i < 40 && seen !== want; i++) {
        const id = `scheme-${n++}`
        a.send({ t: "snapshot", frame: "f1", id })
        const reply = await a.waitFor(() =>
          a.messages.find(
            (m): m is Snapshot => m.t === "snapshot" && m.id === id
          )
        )
        seen =
          "localStorage" in reply
            ? reply.localStorage.find(([k]) => k === "scheme")?.[1]
            : undefined
        if (seen !== want) await new Promise((r) => setTimeout(r, 100))
      }
      return seen
    }
    a.send({ t: "navigate", frame: "f1", route: "/scheme" })
    await a.waitFor(() => routeOf(a, "f1")?.path === "/scheme" || undefined)
    expect(await schemeIs("light")).toBe("light")

    a.send({ t: "scheme", frame: "f1", scheme: "dark" })
    expect(await schemeIs("dark")).toBe("dark")
    // Anything but light or dark is ignored.
    a.send({ t: "scheme", frame: "f1", scheme: "sepia" as "dark" })
    a.send({ t: "reload", frame: "f1" })
    expect(await schemeIs("dark")).toBe("dark")

    a.send({ t: "scheme", frame: "f1", scheme: "light" })
    expect(await schemeIs("light")).toBe("light")
    // Back where the next test expects it.
    a.send({ t: "navigate", frame: "f1", route: "/store" })
    await a.waitFor(() => routeOf(a, "f1")?.path === "/store" || undefined)
  }, 30_000)

  it("reloads the frame at its URL when the browser restarts", async () => {
    const [a] = viewers.slice(-2) as [Viewer, Viewer]
    const before = a.videos.length
    const requestsBefore = requests.length
    // The frame's browser process (not its helpers): this service's child,
    // so another test's service (Frame Drive's) keeps its own.
    const pids = execFileSync("sh", [
      "-c",
      `pgrep -P ${service.pid} -f 'remote-debugging-pipe' || true`,
    ])
      .toString()
      .split("\n")
      .filter(Boolean)
      .filter((pid) => {
        try {
          const cmd = readFileSync(`/proc/${pid}/cmdline`, "utf8")
          return cmd.includes("screenplay-frame-") && !cmd.includes("--type=")
        } catch {
          return false
        }
      })
    expect(pids.length).toBeGreaterThan(0)
    for (const pid of pids) process.kill(Number(pid), "SIGKILL")

    await a.waitFor(() =>
      a.messages.find(
        (m) => m.t === "frame" && m.frame === "f1" && m.status === "restarting"
      )
    )
    const restartedAt = a.messages.length
    await a.waitFor(() =>
      a.messages
        .slice(restartedAt)
        .find((m) => m.t === "frame" && m.frame === "f1" && m.status === "live")
    )
    // Streaming again from a fresh keyframe, back on the page it was on.
    const next = await a.waitFor(() =>
      a.videos.slice(before).find((v) => v.key)
    )
    expect(next.frame).toBe("f1")
    // The service lived through it (cleaning up the dead browser's profile
    // once crashed it, #1419).
    expect(service.exitCode).toBeNull()
    // "live" comes once the frame host page has loaded; the app's page loads
    // in its iframe after that, so wait for the request rather than assume it.
    await a.waitFor(() =>
      requests.slice(requestsBefore).includes("/store") ? true : undefined
    )
    await a.waitFor(() => routeOf(a, "f1")?.path === "/store" || undefined)
  }, 40_000)

  it("relays the bridge: reads to whoever asked, room changes through the primary", async () => {
    const c = await connect("cy")
    const d = await connect("di")
    const watch = {
      t: "watch",
      frame: "f2",
      route: "/bridge",
      width: 640,
      height: 400,
    } as const
    c.send(watch)
    await c.waitFor(() =>
      c.messages.find(
        (m) => m.t === "frame" && m.frame === "f2" && m.status === "live"
      )
    )
    d.send(watch)

    // The page's Knobs reach the primary (who watched first), once.
    const declared = await c.waitFor(() =>
      bridgeOf(c, "f2").find((m) => m.type === "screenplay:knobs-declared")
    )
    expect(declared).toMatchObject({ knobs: [{ id: "color" }] })
    expect(bridgeOf(d, "f2")).toEqual([])
    expect(JSON.stringify(bridgeOf(c, "f2"))).not.toContain("forged")

    // Reads answer whoever asked, under their own id, even when two viewers
    // pick the same one.
    await expect(
      read(c, "f2", "q1", { op: "getDocumentSize" })
    ).resolves.toEqual({
      width: 900,
      height: 1200,
    })
    await expect(
      read(d, "f2", "q1", { op: "elementAtPoint", x: 10, y: 10 })
    ).resolves.toMatchObject({
      tagName: "button",
      id: "pay",
      rect: { x: 0, y: 0 },
    })
    expect(
      bridgeOf(c, "f2").filter((m) => m.type === "screenplay:dom-result")
    ).toHaveLength(1)

    // A Knob's value from the room reaches the page through the primary;
    // the same change echoed by another viewer doesn't.
    const knob = (v: Viewer, color: string) =>
      v.send({
        t: "bridge",
        frame: "f2",
        message: { type: "screenplay:knob-values", values: { color } },
      })
    const colored = (v: Viewer, color: string, id: string) =>
      read(v, "f2", id, {
        op: "querySelector",
        selector: `body[data-color="${color}"]`,
      })
    knob(d, "red")
    knob(c, "green")
    await expect
      .poll(() => colored(c, "green", `g${Date.now()}`))
      .not.toBeNull()
    await expect(colored(d, "red", "r1")).resolves.toBeNull()

    // When the primary leaves, the next viewer takes over and hears the
    // page's Knobs, so it can push the room's values.
    c.send({ t: "unwatch", frame: "f2" })
    await d.waitFor(() =>
      bridgeOf(d, "f2").find((m) => m.type === "screenplay:knobs-declared")
    )
    knob(d, "red")
    await expect.poll(() => colored(d, "red", `r${Date.now()}`)).not.toBeNull()

    // Let f2 go, so the cap tests below start with one paused frame to
    // close rather than racing to close the frame they just paused.
    d.send({ t: "unwatch", frame: "f2" })
    await d.waitFor(() => serviceLog.includes("frame f2: paused") || undefined)
  }, 40_000)

  // ---- pause and the cap (#1393) ----

  const click = (v: Viewer, frame: string) => {
    for (const type of ["mousePressed", "mouseReleased"] as const)
      v.send({
        t: "input",
        frame,
        kind: "mouse",
        type,
        x: 100,
        y: 100,
        button: "left",
        buttons: type === "mousePressed" ? 1 : 0,
        clickCount: 1,
        modifiers: 0,
      })
  }

  const liveAfter = (v: Viewer, frame: string, from: number) =>
    v.waitFor(() =>
      v.messages
        .slice(from)
        .find(
          (m) => m.t === "frame" && m.frame === frame && m.status === "live"
        )
    )

  /** Waits until no picture has arrived for `quiet` ms. */
  async function settle(v: Viewer, frame: string, quiet = 1000) {
    let count = -1
    let since = Date.now()
    await v.waitFor(() => {
      const n = v.videos.filter((x) => x.frame === frame).length
      if (n !== count) {
        count = n
        since = Date.now()
      }
      return Date.now() - since >= quiet || undefined
    })
  }

  it("pauses after the last viewer leaves, and resumes with the last picture first and the page's state intact", async () => {
    await ready()
    // Make room first: with f1 and the bridge test's f2 still watched, p1
    // pausing would pass the cap and close at once, racing the watch below.
    // Paused, f2 is the one the cap closes when p1 starts.
    for (const v of viewers) v.send({ t: "unwatch", frame: "f2" })
    await waitUntil(() => serviceLog.includes("frame f2: paused") || undefined)
    const c = await connect("cy")
    c.send({ t: "watch", frame: "p1", route: "/app", width: 400, height: 300 })
    await c.waitFor(
      () => serviceLog.includes("frame f2: closed its browser") || undefined
    )
    await liveAfter(c, "p1", 0)
    await c.waitFor(() => c.videos.find((v) => v.frame === "p1"))
    await c.waitFor(() => requests.find((r) => r.startsWith("/report?")))
    // Painted, so the click lands.
    await settle(c, "p1")
    c.send({
      t: "drive",
      frame: "p1",
      token: driveToken(KEY, "cy", "p1").token,
    })
    click(c, "p1")
    await c.waitFor(() => requests.includes("/count?n=1") || undefined)
    await settle(c, "p1")
    const lastKey = c.videos.filter((v) => v.frame === "p1" && v.key).at(-1)!

    const loads = requests.filter((r) => r === "/app").length
    c.send({ t: "unwatch", frame: "p1" })
    await c.waitFor(() => serviceLog.includes("frame p1: paused") || undefined)

    const before = c.videos.length
    const watchedAt = c.messages.length
    c.send({ t: "watch", frame: "p1", route: "/app", width: 400, height: 300 })
    // The paused frame's last picture comes first, still live: the browser
    // never stopped.
    const first = await c.waitFor(() => c.videos[before])
    expect(first.frame).toBe("p1")
    expect(first.key).toBe(true)
    expect(Buffer.from(first.data).equals(Buffer.from(lastKey.data))).toBe(true)
    expect(
      c.messages
        .slice(watchedAt)
        .find((m) => m.t === "frame" && m.frame === "p1")
    ).toMatchObject({ status: "live" })

    // The page kept its in-memory count and never reloaded.
    c.send({
      t: "drive",
      frame: "p1",
      token: driveToken(KEY, "cy", "p1").token,
    })
    click(c, "p1")
    await c.waitFor(() => requests.includes("/count?n=2") || undefined)
    expect(requests.filter((r) => r === "/app").length).toBe(loads)
    expect(serviceLog).not.toContain("frame p1: closed")
  }, 40_000)

  it("never re-sends an unchanged picture", async () => {
    const c = viewers.at(-1)!
    await settle(c, "p1")
    const count = c.videos.filter((v) => v.frame === "p1").length
    await new Promise((r) => setTimeout(r, 1500))
    // At 30 fps that's 45 pictures of a page that didn't change.
    expect(c.videos.filter((v) => v.frame === "p1").length).toBe(count)

    // A change still goes out.
    click(c, "p1")
    await c.waitFor(
      () => c.videos.filter((v) => v.frame === "p1").length > count || undefined
    )
  }, 30_000)

  it("closes the least recently viewed paused frame past the cap, and reopens it at its URL with its cookies and storage", async () => {
    await ready()
    const d = await connect("dee")
    const reports = requests.filter((r) => r.startsWith("/report?")).length
    d.send({ t: "watch", frame: "e1", route: "/app", width: 400, height: 300 })
    await liveAfter(d, "e1", 0)
    await d.waitFor(() => d.videos.find((v) => v.frame === "e1"))
    await d.waitFor(
      () =>
        requests.filter((r) => r.startsWith("/report?")).length > reports ||
        undefined
    )
    await settle(d, "e1")
    d.send({
      t: "drive",
      frame: "e1",
      token: driveToken(KEY, "dee", "e1").token,
    })
    const counted = requests.filter((r) => r === "/count?n=1").length
    click(d, "e1")
    await d.waitFor(
      () =>
        requests.filter((r) => r === "/count?n=1").length > counted || undefined
    )
    d.send({ t: "unwatch", frame: "e1" })
    await d.waitFor(() => serviceLog.includes("frame e1: paused") || undefined)

    // f1 and p1 are watched, so a new frame passes the cap and the paused
    // e1 closes.
    d.send({ t: "watch", frame: "e2", route: "/", width: 400, height: 300 })
    await d.waitFor(
      () => serviceLog.includes("frame e1: closed its browser") || undefined
    )
    expect(serviceLog).not.toContain("frame p1: closed")
    expect(serviceLog).not.toContain("frame f1: closed")

    const reopenedAt = requests.length
    const watchedAt = d.messages.length
    d.send({ t: "watch", frame: "e1", route: "/app", width: 400, height: 300 })
    await liveAfter(d, "e1", watchedAt)
    // It loads its URL again, with the session cookie, and finds its storage.
    await d.waitFor(() =>
      requests.slice(reopenedAt).find((r) => r.startsWith("/report?"))
    )
    const load = requests.indexOf("/app", reopenedAt)
    expect(load).toBeGreaterThanOrEqual(reopenedAt)
    expect(cookies[load]).toContain("c=1")
    const report = new URLSearchParams(
      requests
        .slice(reopenedAt)
        .find((r) => r.startsWith("/report?"))!
        .slice("/report?".length)
    )
    expect(report.get("local")).toBe("local1")
    expect(report.get("session")).toBe("session1")

    // In-memory state is lost: the count starts again.
    await settle(d, "e1")
    d.send({
      t: "drive",
      frame: "e1",
      token: driveToken(KEY, "dee", "e1").token,
    })
    const recounted = requests.length
    click(d, "e1")
    await d.waitFor(() =>
      requests.slice(recounted).find((r) => r.startsWith("/count?"))
    )
    expect(requests.slice(recounted)).toContain("/count?n=1")
  }, 60_000)
  it("shows a Mockup's page from its HTML, under its policy, and follows changes to it", async () => {
    await ready()
    const m = await connect("mo")
    // The page tries the network, which its policy refuses.
    const doc = (title: string) =>
      mockupSrcDoc(
        `<!doctype html><html><head></head><body>
          <h1>${title}</h1>
          <script>fetch(${JSON.stringify(origin + "/leak")}).catch(() => {})</script>
        </body></html>`,
        MOCKUP_RUNTIME_JS
      )
    const title = async (id: string) => {
      const h1 = await read(m, "m1", id, {
        op: "querySelector",
        selector: "h1",
      })
      return read(m, "m1", `${id}-html`, { op: "getOuterHTML", handle: h1 })
    }
    // A read waits for the page's bridge: one sent while the page loads goes
    // unanswered.
    const loaded = (n: number) =>
      m.waitFor(
        () =>
          bridgeOf(m, "m1").filter((msg) => msg.type === "screenplay:ready")
            .length >= n || undefined
      )
    m.send({
      t: "watch",
      frame: "m1",
      route: "/",
      width: 400,
      height: 300,
      doc: doc("One"),
    })
    await loaded(1)
    await expect(title("a")).resolves.toBe("<h1>One</h1>")

    m.send({ t: "doc", frame: "m1", doc: doc("Two") })
    await loaded(2)
    await expect(title("b")).resolves.toBe("<h1>Two</h1>")
    expect(requests).not.toContain("/leak")
  }, 60_000)
})
