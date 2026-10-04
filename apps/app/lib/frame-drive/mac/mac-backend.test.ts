// @vitest-environment jsdom
import http from "node:http"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WebSocket as NodeWebSocket } from "ws"

import { frameDriveContract } from "@/lib/frame-drive/contract-suite"
import type { DriveOp } from "@/lib/frame-drive/contract"
import {
  macAskerCanvas,
  macFrameDriveBackend,
  visiblePart,
} from "@/lib/frame-drive/mac/channel"
import {
  FRAME_DRIVE_PATH,
  FRAME_DRIVE_ROOM_PARAM,
} from "@/lib/frame-drive/canvas/protocol"
import {
  createRelayFrames,
  runFrameDriveRelay,
} from "@/lib/frame-drive/canvas/relay"
import {
  askBridge,
  PNG,
  startTestPage,
  testPage,
} from "@/lib/frame-drive/test-page"
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

const SECRET = "drive-test-secret"
const ROOM = "drive-room"
const FRAME = "frame-1"
let server: YjsServerHandle
let dataDir: string
let agentDrives = true
const controlListeners = new Set<() => void>()
const snapshots: unknown[] = []
const reveals: string[] = []
const frames = createRelayFrames()
let relay: { close(): void } | null = null

function connectRelay(url: string) {
  const socket = new NodeWebSocket(url, { origin: window.location.origin })
  relay = runFrameDriveRelay(socket, {
    frames,
    agentDrives: () => agentDrives,
    subscribeControl: (listener) => {
      controlListeners.add(listener)
      return () => controlListeners.delete(listener)
    },
    reveal: async (frameId) => {
      reveals.push(frameId)
      return frameId === FRAME
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
  startTestPage()
  server = await startLocalYjsServer({
    port: 0,
    secret: SECRET,
    // This page's own origin is the app's.
    appPort: window.location.port || "80",
  })
  frames.register(FRAME, {
    drive: (op: DriveOp) => askBridge({ type: "screenplay:drive", op }),
    stop: () => void askBridge({ type: "screenplay:drive-stop" }),
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
    ...testPage,
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

  it("snapshots the frame’s rect in the canvas window", async () => {
    snapshots.length = 0
    const result = await backend.screenshot(FRAME)
    expect(result.status).toBe("shot")
    expect(snapshots).toEqual([{ x: 0, y: 0, width: 400, height: 300 }])
  })

  it("asks the canvas showing the frame to bring it into view", async () => {
    const canvas = macAskerCanvas(ROOM)
    reveals.length = 0
    expect(await canvas.reveal(FRAME)).toBeNull()
    expect(reveals).toEqual([FRAME])
    expect(await canvas.reveal("not-here")).toMatch(/isn’t loaded/)
  })

  it("draws the agent’s cursor at show pace, typing a character at a time", async () => {
    document.body.innerHTML = `<input id="name" aria-label="Name">`
    const inputs: string[] = []
    document
      .getElementById("name")!
      .addEventListener("input", (e) =>
        inputs.push((e.target as HTMLInputElement).value)
      )
    const typing = backend.run(FRAME, {
      op: "type",
      target: { selector: "#name" },
      text: "Ada",
      pace: "show",
    })
    await new Promise((r) => setTimeout(r, 100))
    const cursor = document.getElementById("__screenplay-drive-cursor")
    expect(cursor?.textContent).toBe("Agent")
    expect(cursor?.style.pointerEvents).toBe("none")
    // The field is untouched while the cursor glides to it.
    expect(inputs).toEqual([])
    expect(await typing).toMatchObject({ status: "done" })
    expect(inputs).toEqual(["A", "Ad", "Ada"])
    // Reads never list it.
    const page = await backend.run(FRAME, { op: "elements" })
    expect(JSON.stringify(page)).not.toContain("Agent")
    // A step at jump pace clears it at once.
    await backend.run(FRAME, {
      op: "click",
      target: { selector: "#name" },
      pace: "jump",
    })
    expect(document.getElementById("__screenplay-drive-cursor")).toBeNull()
  })

  it("stops a show-pace step that’s still gliding when control moves away", async () => {
    document.body.innerHTML = `<button id="save">Save</button><p id="out">idle</p>`
    let clicked = false
    document.getElementById("save")!.addEventListener("click", () => {
      clicked = true
    })
    const click = backend.run(FRAME, {
      op: "click",
      target: { selector: "#save" },
      pace: "show",
    })
    await new Promise((r) => setTimeout(r, 100))
    agentDrives = false
    controlListeners.forEach((listener) => listener())
    try {
      expect(await click).toEqual({ status: "taken" })
      expect(clicked).toBe(false)
    } finally {
      agentDrives = true
    }
  })

  it("says the canvas isn’t open when no canvas shows the Room", async () => {
    const other = macFrameDriveBackend("closed-room", {
      snapshot: async () => PNG,
    })
    const reason = await other.unavailable(FRAME)
    expect(reason).toMatch(/isn’t showing this canvas/)
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

  it("keeps only what’s inside the window", () => {
    expect(
      visiblePart(
        { x: -50, y: 700, width: 300, height: 200 },
        { width: 1000, height: 800 }
      )
    ).toEqual({ x: 0, y: 700, width: 250, height: 100 })
  })
})
