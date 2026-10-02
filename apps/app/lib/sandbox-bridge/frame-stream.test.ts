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

// The Frame Stream service end to end (#1392), in the style of the #1366
// prototype's bench: a real Xvfb, Chromium and ffmpeg behind the service's
// WebSocket, a stand-in dev server, and viewers that speak the wire protocol.
// Skipped where the browser stack isn't installed.

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
  !!which("ffmpeg")

const KEY = "test-stream-key"

// Left half: a link to /next. Right half: a link to /other.
const PAGE = (path: string) => `<!doctype html><html><head><style>
  body { margin: 0 }
  a { position: fixed; top: 0; bottom: 0; width: 50%; }
  #next { left: 0; background: #cde } #other { right: 0; background: #edc }
</style></head><body data-path="${path}">
  <a id="next" href="/next">next</a><a id="other" href="/other">other</a>
</body></html>`

type Viewer = {
  ws: WebSocket
  messages: FrameStreamServerMessage[]
  videos: { frame: string; key: boolean; data: Uint8Array }[]
  send(msg: FrameStreamClientMessage): void
  waitFor<T>(pick: () => T | undefined, timeout?: number): Promise<T>
}

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
  const requests: string[] = []
  const viewers: Viewer[] = []

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

  type RouteMessage = Extract<FrameStreamServerMessage, { t: "route" }>
  const routeOf = (v: Viewer, frame: string) =>
    v.messages
      .filter((m): m is RouteMessage => m.t === "route" && m.frame === frame)
      .at(-1)

  beforeAll(async () => {
    devServer = http.createServer((req, res) => {
      requests.push(req.url ?? "/")
      res.writeHead(200, { "content-type": "text/html" })
      res.end(PAGE(req.url ?? "/"))
    })
    await new Promise<void>((r) => devServer.listen(0, "127.0.0.1", r))
    const origin = `http://127.0.0.1:${(devServer.address() as AddressInfo).port}`

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
      },
    })
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
    const live = await a.waitFor(() =>
      a.messages.find(
        (m) => m.t === "frame" && m.frame === "f1" && m.status === "live"
      )
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

    // A viewer who joins mid-stream also starts at a keyframe.
    const b = await connect("ben")
    b.send({ t: "watch", frame: "f1", route: "/", width: 640, height: 400 })
    const joined = await b.waitFor(() => b.videos.find((v) => v.frame === "f1"))
    expect(joined.key).toBe(true)
    expect(routeOf(b, "f1")).toMatchObject({ path: "/" })
  }, 40_000)

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
    a.send({
      t: "input",
      frame: "f1",
      kind: "mouse",
      type: "mousePressed",
      x: 100,
      y: 100,
      button: "left",
      buttons: 1,
      clickCount: 1,
      modifiers: 0,
    })
    a.send({
      t: "input",
      frame: "f1",
      kind: "mouse",
      type: "mouseReleased",
      x: 100,
      y: 100,
      button: "left",
      buttons: 0,
      clickCount: 1,
      modifiers: 0,
    })
    await a.waitFor(() => routeOf(a, "f1")?.path === "/next" || undefined)
    await b.waitFor(() => routeOf(b, "f1")?.path === "/next" || undefined)
    expect(
      [...a.messages, ...b.messages].some(
        (m) => m.t === "route" && m.path === "/other"
      )
    ).toBe(false)
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

  it("reloads the frame at its URL when the browser restarts", async () => {
    const [a] = viewers.slice(-2) as [Viewer, Viewer]
    const before = a.videos.length
    const requestsBefore = requests.length
    // The frame's browser process (not its helpers).
    const pids = execFileSync("sh", [
      "-c",
      "pgrep -f 'remote-debugging-pipe' || true",
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
    expect(requests.slice(requestsBefore)).toContain("/other?tab=2")
    expect(routeOf(a, "f1")?.path).toBe("/other?tab=2")
  }, 40_000)
})
