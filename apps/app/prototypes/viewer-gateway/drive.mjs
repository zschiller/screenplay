// PROTOTYPE (issue #991) — drives a viewer and a sharer side by side against a
// running gateway, and prints what happened. Not a test; a probe.
//
//   GATEWAY=http://127.0.0.1:4100 SIDECAR=http://127.0.0.1:3947 ROOM=<id> OUT=<dir> node drive.mjs

import { mkdirSync } from "node:fs"
import { join } from "node:path"
import { chromium } from "playwright-core"
import { WebSocket } from "ws"
import * as Y from "yjs"
import { WebsocketProvider } from "y-websocket"

const { GATEWAY, SIDECAR, ROOM, OUT = "." } = process.env
mkdirSync(OUT, { recursive: true })

// A plain Yjs peer on the sidecar: reads the authoritative doc, and plays the
// sharer's edits.
function sidecarPeer() {
  const doc = new Y.Doc()
  const p = new WebsocketProvider("ws://127.0.0.1:1234", ROOM, doc, {
    WebSocketPolyfill: WebSocket,
  })
  return new Promise((r) => p.on("sync", (s) => s && r({ doc, p })))
}
const hash = (doc) =>
  Buffer.from(Y.encodeStateVector(doc)).toString("base64")

const { doc: truth } = await sidecarPeer()
const before = hash(truth)

const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
})

// The sharer: the real app, straight on the sidecar.
const sharerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const sharer = await sharerCtx.newPage()
await sharer.goto(`${SIDECAR}/${ROOM}`)
await sharer.waitForTimeout(4000)

// The viewer: through the gateway only.
const viewerCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const viewer = await viewerCtx.newPage()
const requests = []
viewer.on("request", (r) => requests.push(`${r.method()} ${r.url()}`))
const failed = []
viewer.on("response", (r) => {
  if (r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${r.url()}`)
})
const consoleErrors = []
viewer.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text().slice(0, 200)))
viewer.on("websocket", (ws) => requests.push(`WS ${ws.url()}`))

await viewer.goto(`${GATEWAY}/${ROOM}`)
await viewer.waitForTimeout(8000)
await viewer.screenshot({ path: join(OUT, "1-viewer-open.png") })
await sharer.screenshot({ path: join(OUT, "1-sharer.png") })

// Live follow: the sharer renames a frame (a doc edit on the sidecar).
const frames = truth.getMap("iframeLayers")
const firstId = [...frames.keys()][0]
const oldLabel = frames.get(firstId).get("label")
frames.get(firstId).set("label", "Renamed by the sharer")
await viewer.waitForTimeout(1500)
const viewerSeesRename = await viewer
  .getByText("Renamed by the sharer")
  .count()
await viewer.screenshot({ path: join(OUT, "2-viewer-after-sharer-edit.png") })

// Sharer moves their pointer across the canvas (presence).
for (let i = 0; i < 10; i++) {
  await sharer.mouse.move(500 + i * 30, 400 + i * 10)
  await sharer.waitForTimeout(100)
}
await viewer.waitForTimeout(1000)
await viewer.screenshot({ path: join(OUT, "3-viewer-sharer-pointer.png") })

// The viewer tries to edit: drag the first frame's label, press delete, type.
const afterRename = hash(truth)
await viewer.mouse.move(700, 450)
await viewer.mouse.down()
await viewer.mouse.move(900, 600, { steps: 10 })
await viewer.mouse.up()
await viewer.keyboard.press("Delete")
await viewer.keyboard.type("viewer was here")
await viewer.waitForTimeout(2000)
await viewer.screenshot({ path: join(OUT, "4-viewer-after-trying-to-edit.png") })
const afterViewer = hash(truth)

frames.get(firstId).set("label", oldLabel) // put the fixture back

const stats = await (await fetch(`${GATEWAY}/__viewer/stats`)).json()
console.log(
  JSON.stringify(
    {
      viewerSeesRename,
      sidecarDocChangedByViewer: afterViewer !== afterRename,
      sidecarDocChangedBySharer: afterRename !== before,
      gatewayStats: stats,
      viewerRequests: [...new Set(requests.map((r) => r.replace(/\/_next\/static\/.*/, "/_next/static/*").replace(/\?.*/, "")))],
      viewerFailed: [...new Set(failed.map((r) => r.replace(/\?.*/, "")))],
      viewerConsoleErrors: [...new Set(consoleErrors)].slice(0, 15),
    },
    null,
    2
  )
)
await browser.close()
process.exit(0)
