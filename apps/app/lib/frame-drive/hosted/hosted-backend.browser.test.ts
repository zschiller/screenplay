import { execFileSync, spawn, type ChildProcess } from "node:child_process"
import { existsSync } from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { fileURLToPath } from "node:url"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import WebSocket from "ws"

import { AGENT_PARTY } from "@/lib/canvas/frame-control"
import type {
  DriveOp,
  DriveResult,
  FrameDriveBackend,
} from "@/lib/frame-drive/contract"
import { frameDriveContract } from "@/lib/frame-drive/contract-suite"
import { hostedFrameDriveBackend } from "@/lib/frame-drive/hosted/backend"
import type {
  FrameStreamClientMessage,
  FrameStreamServerMessage,
} from "@/lib/frame-stream/protocol"
import { agentGrant, driveToken, viewToken } from "@/lib/frame-stream/token"
import { BRIDGE_JS } from "@/lib/sandbox-bridge"

// The hosted Frame Drive backend end to end (#1396): the real Frame Stream
// service with Xvfb and Chromium, as it runs in a Workspace Sandbox, a
// stand-in dev server whose pages carry the Sandbox Bridge, and the backend
// talking to the service as the agent. A viewer watches the same frame, as a
// second person would. Skipped where the browser stack isn't installed.

const SCRIPT = fileURLToPath(
  new URL("../../sandbox-bridge/frame-stream.mjs", import.meta.url)
)

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
// CI's browser job installs the stack; there a missing piece is a failure,
// not a skip, so the test can't drop out of CI unnoticed.
if (process.env.SCREENPLAY_REQUIRE_BROWSER_STACK && !HAS_STACK) {
  throw new Error("Chrome, Xvfb and ffmpeg are required but not all found")
}

const KEY = "test-drive-key"
const FRAME = "drive-frame"
const SIZE = { width: 800, height: 600 }

// Every page reports a script run from outside (`window.__evaluated`) in its
// title, so a read can tell.
const page = (body: string) => `<!doctype html><html><head>
<script>${BRIDGE_JS}</script>
<script>setInterval(() => { if (window.__evaluated) document.title = "evaluated" }, 20)</script>
<style>body { margin: 8px; font: 14px sans-serif } #tall { height: 2000px }</style>
</head><body>${body}<div id="tall"></div></body></html>`

const pages = new Map<string, string>()
// Paths the stand-in dev server answers late, in ms.
const slow = new Map<string, number>()
let devServer: http.Server
let service: ChildProcess | null = null
let port = 0
let streamUrl = ""
let route = "/start"
let seq = 0

type Viewer = {
  ws: WebSocket
  messages: FrameStreamServerMessage[]
  videos: number
  send(msg: FrameStreamClientMessage): void
}

/** How long the run's first browser may take to start. */
const FIRST_START_MS = 60_000

async function waitUntil<T>(
  pick: () => T | undefined | Promise<T | undefined>,
  timeout = 20_000
): Promise<T> {
  const start = Date.now()
  for (;;) {
    const value = await pick()
    if (value !== undefined && value !== false) return value
    if (Date.now() - start > timeout) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 25))
  }
}

async function connect(userId: string): Promise<Viewer> {
  const ws = new WebSocket(streamUrl)
  const viewer: Viewer = {
    ws,
    messages: [],
    videos: 0,
    send: (msg) => ws.send(JSON.stringify(msg)),
  }
  ws.on("message", (data, isBinary) => {
    if (isBinary) viewer.videos++
    else viewer.messages.push(JSON.parse(String(data)))
  })
  await new Promise((r) => ws.once("open", r))
  viewer.send({ t: "auth", token: viewToken(KEY, userId).token })
  await waitUntil(() => viewer.messages.find((m) => m.t === "ready"))
  return viewer
}

const backend: FrameDriveBackend = hostedFrameDriveBackend({
  frame: async () => ({ route, ...SIZE, stream: { url: streamUrl, key: KEY } }),
})
const run = (op: DriveOp) => backend.run(FRAME, op)
const read = async (selector?: string) => {
  const result = await run({ op: "elements", selector })
  if (result.status !== "read") throw new Error(JSON.stringify(result))
  return result.value
}
const out = async () => (await read("#out")).read?.text.trim()

let ana: Viewer

/** One op from a raw agent connection, with whatever grant it carries. */
async function agentOp(op: DriveOp, grant?: string): Promise<DriveResult> {
  const agent = new WebSocket(streamUrl)
  const answers: FrameStreamServerMessage[] = []
  agent.on("message", (d, bin) => !bin && answers.push(JSON.parse(String(d))))
  await new Promise((r) => agent.once("open", r))
  const send = (m: FrameStreamClientMessage) => agent.send(JSON.stringify(m))
  send({ t: "auth", token: viewToken(KEY, AGENT_PARTY).token })
  await waitUntil(() => answers.find((m) => m.t === "ready"))
  send({ t: "agent", id: "op", op, grant, frame: FRAME, route, ...SIZE })
  const answer = await waitUntil(() =>
    answers.find(
      (m): m is Extract<FrameStreamServerMessage, { t: "agent-result" }> =>
        m.t === "agent-result"
    )
  )
  agent.close()
  return answer.result
}

/** Show `html` in the frame: Ana's canvas sends the room's new route. */
async function load(html: string) {
  const path = `/p${++seq}`
  pages.set(path, page(html))
  route = path
  ana.send({ t: "navigate", frame: FRAME, route: path })
  await waitUntil(async () => {
    const result = await run({ op: "elements" })
    return result.status === "read" && result.value.path === path
  })
}

beforeAll(async () => {
  if (!HAS_STACK) return
  devServer = http.createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0]!
    setTimeout(
      () => {
        res.writeHead(200, { "content-type": "text/html" })
        res.end(pages.get(path) ?? page("<p>start</p>"))
      },
      slow.get(path) ?? 0
    )
  })
  await new Promise<void>((r) => devServer.listen(0, "127.0.0.1", r))
  const origin = `http://127.0.0.1:${(devServer.address() as AddressInfo).port}`

  const probe = http.createServer()
  await new Promise<void>((r) => probe.listen(0, "127.0.0.1", r))
  port = (probe.address() as AddressInfo).port
  await new Promise((r) => probe.close(r))
  streamUrl = `ws://127.0.0.1:${port}/`

  service = spawn(process.execPath, [SCRIPT], {
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      SCREENPLAY_STREAM_PORT: String(port),
      SCREENPLAY_STREAM_HOST: "127.0.0.1",
      SCREENPLAY_STREAM_KEY: KEY,
      SCREENPLAY_FRAME_ORIGIN: origin,
      SCREENPLAY_CHROME: CHROME!,
      // Far from the Frame Stream test's displays, which can run alongside.
      SCREENPLAY_STREAM_DISPLAY: String(400 + (process.pid % 50)),
    },
  })
  await waitUntil(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${port}/health`)).ok
    } catch {
      return false
    }
  })
  ana = await connect("ana")
  ana.send({ t: "watch", frame: FRAME, route, ...SIZE })
  // The first browser of the run starts cold, and slowly on a CI runner.
  await waitUntil(
    () =>
      ana.messages.find(
        (m) => m.t === "frame" && m.frame === FRAME && m.status === "live"
      ),
    FIRST_START_MS
  )
}, 90_000)

afterAll(async () => {
  ana?.ws.close()
  service?.kill("SIGTERM")
  await new Promise((r) => (devServer ? devServer.close(r) : r(null)))
})

frameDriveContract("hosted (the shared browser on a real Chromium)", {
  skip: !HAS_STACK,
  setup: async () => ({
    backend,
    frameId: FRAME,
    load,
    async evaluated() {
      await new Promise((r) => setTimeout(r, 100))
      return (await read()).title === "evaluated"
    },
  }),
  // Real input: only a file, which Claude has none of, is out of reach.
  gaps: ["file-picker"],
})

describe.skipIf(!HAS_STACK)("hosted Frame Drive", () => {
  it("makes real gestures: hover, focus and Tab work", async () => {
    await load(`
      <style>#hover:hover { color: rgb(255, 0, 0) }</style>
      <button id="hover">Hover me</button>
      <input id="first" aria-label="First">
      <input id="second" aria-label="Second">
      <p id="out">idle</p>
      <p id="hovered">no</p>
      <script>
        const out = document.getElementById("out")
        setInterval(() => {
          if (getComputedStyle(document.getElementById("hover")).color === "rgb(255, 0, 0)")
            document.getElementById("hovered").textContent = "yes"
        }, 20)
        document.addEventListener("focusin", (e) => { out.textContent = "focus " + e.target.id })
      </script>`)
    expect(
      await run({ op: "click", target: { text: "Hover me" } })
    ).toMatchObject({
      status: "done",
    })
    // CSS :hover, which only a real pointer sets.
    await waitUntil(async () => (await read("#hovered")).read?.text === "yes")
    expect(
      await run({ op: "type", target: { selector: "#first" }, text: "ab" })
    ).toMatchObject({ status: "done", value: { value: "ab" } })
    expect(await out()).toBe("focus first")
    expect(await run({ op: "key", key: "Tab" })).toMatchObject({
      status: "done",
    })
    expect(await out()).toBe("focus second")
    // A key with a field target types its character there.
    expect(
      await run({ op: "key", key: "c", target: { selector: "#first" } })
    ).toMatchObject({ status: "done" })
    expect((await read("#first")).read?.value).toBe("abc")
  }, 30_000)

  it("drags with HTML5 drag and drop, and scrolls an area", async () => {
    await load(`
      <div id="card" draggable="true" style="width:80px;height:40px;background:#cde">Card</div>
      <div id="bin" aria-label="Bin" role="button" style="width:120px;height:80px;margin-top:40px;background:#edc">Bin</div>
      <div id="list" style="height:100px;overflow:auto"><div style="height:600px">List</div></div>
      <p id="out">idle</p>
      <script>
        const out = document.getElementById("out")
        document.getElementById("card").addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", "card"))
        const bin = document.getElementById("bin")
        bin.addEventListener("dragover", (e) => e.preventDefault())
        bin.addEventListener("drop", (e) => { e.preventDefault(); out.textContent = "dropped " + e.dataTransfer.getData("text/plain") })
      </script>`)
    expect(
      await run({
        op: "drag",
        target: { selector: "#card" },
        to: { selector: "#bin" },
      })
    ).toMatchObject({ status: "done" })
    expect(await out()).toBe("dropped card")
    expect(
      await run({ op: "scroll", target: { selector: "#list" }, dy: 150 })
    ).toMatchObject({
      status: "done",
      value: { target: { selector: "#list" }, scrolled: { x: 0, y: 150 } },
    })
  }, 30_000)

  it("is seen live by a second person watching the frame", async () => {
    await load(`<a href="/next-page" id="go">Next page</a>`)
    pages.set("/next-page", page(`<p id="out">arrived</p>`))
    // The old page is still there to answer while the next one loads.
    slow.set("/next-page", 500)
    const ben = await connect("ben")
    ben.send({ t: "watch", frame: FRAME, route, ...SIZE })
    await waitUntil(() => ben.videos > 0)
    expect(
      await run({ op: "click", target: { text: "Next page" } })
    ).toMatchObject({
      status: "done",
      value: { path: "/next-page" },
    })
    await waitUntil(() =>
      ben.messages.find(
        (m) => m.t === "route" && m.frame === FRAME && m.path === "/next-page"
      )
    )
    ben.ws.close()
  }, 30_000)

  it("stops the moment a person takes over, and refuses the agent's older grant", async () => {
    await load(`<input id="name" aria-label="Name">`)
    const typing = run({
      op: "type",
      target: { selector: "#name" },
      text: "x".repeat(400),
    })
    // Ana presses the driver button: the app signs her a grant.
    await waitUntil(async () => {
      const value = (await read("#name")).read?.value ?? ""
      return value.length > 5
    })
    ana.send({
      t: "drive",
      frame: FRAME,
      token: driveToken(KEY, "ana", FRAME).token,
    })
    expect(await typing).toEqual({ status: "taken" })
    expect((await read("#name")).read?.value?.length).toBeLessThan(400)
    // A gesture the app let through before her grant doesn't run either.
    expect(
      await agentOp(
        { op: "click", target: { selector: "#name" } },
        agentGrant(KEY, FRAME, Date.now() - 1000).token
      )
    ).toEqual({ status: "taken" })
    // She leaves Interact; the agent drives again.
    ana.send({ t: "release", frame: FRAME })
    expect(
      await run({ op: "click", target: { selector: "#name" } })
    ).toMatchObject({
      status: "done",
    })
  }, 30_000)

  it("refuses a gesture without an agent grant, and agent ops from anyone but the agent", async () => {
    await load(
      `<button id="b" onclick="document.getElementById('out').textContent = 'clicked'">B</button><p id="out">idle</p>`
    )
    const op: DriveOp = { op: "click", target: { selector: "#b" } }
    expect(await agentOp(op)).toEqual({ status: "taken" })
    expect(await agentOp(op, agentGrant(KEY, "another-frame").token)).toEqual({
      status: "taken",
    })
    expect(
      await agentOp(op, driveToken(KEY, AGENT_PARTY, FRAME).token)
    ).toEqual({ status: "taken" })
    const where = { frame: FRAME, route, ...SIZE }

    // A person's connection can't send the agent's ops at all.
    ana.send({
      t: "agent",
      id: "from-ana",
      op,
      grant: agentGrant(KEY, FRAME).token,
      ...where,
    })
    await new Promise((r) => setTimeout(r, 500))
    expect(ana.messages.some((m) => m.t === "agent-result")).toBe(false)
    expect(await out()).toBe("idle")
  }, 30_000)

  it("starts a frame nobody watches, and photographs it", async () => {
    const lone = hostedFrameDriveBackend({
      frame: async () => ({
        route: "/lone",
        width: 400,
        height: 300,
        stream: { url: streamUrl, key: KEY },
      }),
    })
    pages.set("/lone", page(`<p id="out">alone</p>`))
    const result = await lone.run("lone-frame", {
      op: "elements",
      selector: "#out",
    })
    expect(result).toMatchObject({
      status: "read",
      value: { path: "/lone", read: { text: "alone" } },
    })
    const shot = await lone.screenshot("lone-frame")
    expect(shot.status).toBe("shot")
    if (shot.status !== "shot") return
    expect(shot.shot.mediaType).toBe("image/webp")
    expect(shot.shot.data.subarray(8, 12).toString()).toBe("WEBP")
  }, 60_000)
})
