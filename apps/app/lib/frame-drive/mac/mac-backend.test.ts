// @vitest-environment jsdom
import { readFileSync } from "node:fs"
import http from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WebSocket as NodeWebSocket } from "ws"

import { frameDriveContract } from "@/lib/frame-drive/contract-suite"
import type { DriveOp, DriveResult } from "@/lib/frame-drive/contract"
import {
  macFrameDriveBackend,
  visiblePart,
} from "@/lib/frame-drive/mac/channel"
import {
  FRAME_DRIVE_PATH,
  FRAME_DRIVE_ROOM_PARAM,
} from "@/lib/frame-drive/mac/protocol"
import {
  createRelayFrames,
  runFrameDriveRelay,
} from "@/lib/frame-drive/mac/relay"
import {
  startLocalYjsServer,
  type YjsServerHandle,
} from "@/lib/yjs-host/y-websocket-server"

/**
 * The Mac backend end to end, in a test page like the bridge's own tests: the
 * sidecar's channel on the real local Yjs server, the canvas relay connected
 * over a real WebSocket carrying this page's Origin (as the browser stamps
 * it), and the Sandbox Bridge running in the page.
 */

const BRIDGE = readFileSync(
  join(process.cwd(), "lib", "sandbox-bridge", "bridge.js"),
  "utf8"
)
const SECRET = "drive-test-secret"
const ROOM = "drive-room"
const FRAME = "frame-1"
// A 1×1 PNG, standing in for the Mac shell's snapshot.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64"
)

let server: YjsServerHandle
let dataDir: string
let agentDrives = true
const controlListeners = new Set<() => void>()
const snapshots: unknown[] = []
const frames = createRelayFrames()
let relay: { close(): void } | null = null

/** Run one op through the bridge in this page, as the canvas does. */
let nextId = 1
function bridgeDrive(message: Record<string, unknown>): Promise<DriveResult> {
  const id = `d${nextId++}`
  return new Promise((resolve) => {
    function onMessage(e: MessageEvent) {
      const d = e.data
      if (d?.type !== "screenplay:dom-result" || d.id !== id) return
      window.removeEventListener("message", onMessage)
      resolve(d.ok ? d.value : { status: "failed", reason: d.error })
    }
    window.addEventListener("message", onMessage)
    window.dispatchEvent(
      new MessageEvent("message", { data: { ...message, id }, source: window })
    )
  })
}

/** jsdom has no layout: give every shown element a box, and no hit-testing. */
function fakeLayout() {
  const g = globalThis as { CSS?: { escape?: (s: string) => string } }
  g.CSS ??= {}
  g.CSS.escape ??= (s: string) => s.replace(/["\\]/g, "\\$&")
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const shown = !this.closest("[hidden]")
    const box = shown ? { width: 100, height: 20 } : { width: 0, height: 0 }
    return {
      x: 10,
      y: 10,
      top: 10,
      left: 10,
      right: 10 + box.width,
      bottom: 10 + box.height,
      ...box,
      toJSON() {},
    } as DOMRect
  }
  document.elementFromPoint = () => null
  window.scrollBy = () => {}
  // WebKit refuses the clipboard to an untrusted gesture in a frame.
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: () =>
        Promise.reject(new DOMException("denied", "NotAllowedError")),
    },
  })
}

function connectRelay(url: string) {
  const socket = new NodeWebSocket(url, { origin: window.location.origin })
  relay = runFrameDriveRelay(socket, {
    frames,
    agentDrives: () => agentDrives,
    subscribeControl: (listener) => {
      controlListeners.add(listener)
      return () => controlListeners.delete(listener)
    },
  })
}

function driveUrl(token = SECRET) {
  const url = new URL(FRAME_DRIVE_PATH, `ws://127.0.0.1:${server.port}`)
  url.searchParams.set(FRAME_DRIVE_ROOM_PARAM, ROOM)
  url.searchParams.set("token", token)
  return url.toString()
}

async function until(check: () => Promise<boolean>, timeout = 3000) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error("timed out")
    await new Promise((r) => setTimeout(r, 20))
  }
}

const backend = macFrameDriveBackend(ROOM, {
  snapshot: async (rect) => {
    snapshots.push(rect)
    return PNG
  },
})

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "frame-drive-"))
  process.env.YJS_PERSISTENCE_DIR = dataDir
  fakeLayout()
  new Function(BRIDGE)()
  server = await startLocalYjsServer({
    port: 0,
    secret: SECRET,
    // This page's own origin is the app's.
    appPort: window.location.port || "80",
  })
  frames.register(FRAME, {
    drive: (op: DriveOp) => bridgeDrive({ type: "screenplay:drive", op }),
    stop: () => void bridgeDrive({ type: "screenplay:drive-stop" }),
    where: () => ({
      rect: { x: 0, y: 0, width: 400, height: 300 },
      window: { width: 1280, height: 800 },
      zoom: 1,
      visibility: "visible",
    }),
  })
  connectRelay(driveUrl())
  await until(async () => (await backend.unavailable(FRAME)) === null)
})

afterAll(async () => {
  relay?.close()
  await server.close()
  await rm(dataDir, { recursive: true, force: true })
})

frameDriveContract("Mac (Sandbox Bridge in a test page)", {
  setup: async () => ({
    backend,
    frameId: FRAME,
    async load(html) {
      document.body.innerHTML = html
      for (const script of document.body.querySelectorAll("script")) {
        new Function(script.textContent ?? "")()
      }
    },
    async evaluated() {
      return (window as { __evaluated?: boolean }).__evaluated === true
    },
  }),
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

describe("Mac drive channel", () => {
  /** The status a raw upgrade to the channel is answered with. */
  function upgradeStatus(token: string, origin?: string): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = http.request({
        host: "127.0.0.1",
        port: server.port,
        path:
          new URL(driveUrl(token)).pathname + new URL(driveUrl(token)).search,
        headers: {
          Connection: "Upgrade",
          Upgrade: "websocket",
          "Sec-WebSocket-Version": "13",
          "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
          ...(origin ? { Origin: origin } : {}),
        },
      })
      req.on("upgrade", (res, socket) => {
        socket.destroy()
        resolve(res.statusCode ?? 101)
      })
      req.on("response", (res) => resolve(res.statusCode ?? 0))
      req.on("error", reject)
      req.end()
    })
  }

  it("refuses a wrong secret or a foreign Origin", async () => {
    const appOrigin = window.location.origin
    expect(await upgradeStatus("wrong", appOrigin)).toBe(401)
    expect(await upgradeStatus(SECRET, "https://evil.example")).toBe(403)
    expect(await upgradeStatus(SECRET)).toBe(403)
    expect(await upgradeStatus(SECRET, appOrigin)).toBe(101)
  })

  it("refuses a gesture when Frame Control says the agent no longer drives", async () => {
    agentDrives = false
    try {
      expect(
        await backend.run(FRAME, { op: "click", target: { text: "x" } })
      ).toEqual({ status: "taken" })
      // Reads don't need control.
      expect((await backend.run(FRAME, { op: "elements" })).status).toBe("read")
    } finally {
      agentDrives = true
    }
  })

  it("stops a running drag the moment control moves away", async () => {
    document.body.innerHTML = `<div id="a">a</div><div id="b">b</div>`
    const drag = backend.run(FRAME, {
      op: "drag",
      target: { selector: "#a" },
      to: { selector: "#b" },
    })
    await new Promise((r) => setTimeout(r, 30))
    agentDrives = false
    controlListeners.forEach((listener) => listener())
    try {
      expect(await drag).toEqual({ status: "taken" })
    } finally {
      agentDrives = true
    }
  })

  it("snapshots the frame's rect in the canvas window", async () => {
    snapshots.length = 0
    const result = await backend.screenshot(FRAME)
    expect(result.status).toBe("shot")
    expect(snapshots).toEqual([{ x: 0, y: 0, width: 400, height: 300 }])
  })

  it("says the canvas isn't open when no canvas shows the Room", async () => {
    const other = macFrameDriveBackend("closed-room", {
      snapshot: async () => PNG,
    })
    const reason = await other.unavailable(FRAME)
    expect(reason).toMatch(/isn't showing this canvas/)
    expect(
      await other.run(FRAME, { op: "click", target: { text: "Save" } })
    ).toMatchObject({ status: "unavailable" })
    expect(await other.screenshot(FRAME)).toMatchObject({
      status: "unavailable",
    })
  })
})

describe("visiblePart", () => {
  it("snaps a fractional frame inward, so no border sliver shows", () => {
    expect(
      visiblePart(
        { x: 10.4, y: 20.6, width: 300, height: 200 },
        { width: 1000, height: 800 }
      )
    ).toEqual({ x: 11, y: 21, width: 299, height: 199 })
  })

  it("keeps only what's inside the window", () => {
    expect(
      visiblePart(
        { x: -50, y: 700, width: 300, height: 200 },
        { width: 1000, height: 800 }
      )
    ).toEqual({ x: 0, y: 700, width: 250, height: 100 })
  })
})
