// Direct access to a canvas's Yjs document through the local build's
// y-websocket server. Used to lay out frames and set the camera precisely,
// which is far more reliable than dragging on the canvas.
import { appRequire, sleep } from "./env.mjs"

const Y = appRequire("yjs")
const { WebsocketProvider } = appRequire("y-websocket")
const WS = appRequire("ws")

const WS_URL = `ws://127.0.0.1:${process.env.NEXT_PUBLIC_YJS_WS_PORT ?? 1234}`

/** Connect to a room, run `fn(doc, Y)` in one transaction, then disconnect. */
export async function editRoom(roomId, fn) {
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(WS_URL, roomId, doc, {
    WebSocketPolyfill: WS,
  })
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`y-websocket sync timeout for ${roomId}`)), 15000)
    provider.on("sync", (synced) => synced && (clearTimeout(t), resolve()))
  })
  // When no client is connected, the server may still be loading the room from
  // disk as we connect, and the first sync can arrive empty. Writing into that
  // empty doc would create concurrent duplicates of existing records (random
  // winner on merge), so wait until the room's content has arrived.
  const hasContent = () =>
    ["repos", "branches", "meta", "iframeLayers", "chatSessions"].some((k) => doc.getMap(k).size > 0)
  for (let i = 0; i < 40 && !hasContent(); i++) await sleep(200)
  let result
  doc.transact(() => {
    result = fn(doc, Y)
  })
  await sleep(1200) // let the update flush to the server
  provider.destroy()
  doc.destroy()
  return result
}

/** Read a room as plain JSON (skipping the large stream/editor collections). */
export function readRoom(roomId) {
  return editRoom(roomId, (doc) => {
    const out = {}
    for (const [key] of doc.share) {
      if (key.startsWith("stream") || key.startsWith("markdown-layer-")) continue
      out[key] = doc.getMap(key).toJSON()
    }
    return out
  })
}

/** Write a record into a collection as a nested Y.Map (the app's storage shape). */
export function setRecord(Yns, map, id, obj) {
  let inner = map.get(id)
  if (!(inner instanceof Yns.Map)) {
    inner = new Yns.Map()
    map.set(id, inner)
  }
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) inner.set(k, v)
  return inner
}

/**
 * Set the saved camera. `x`/`y` are in canvas-container pixels: the container
 * starts after the 240px left sidebar, so `x: 16` sits just right of it.
 */
export function setViewport(roomId, viewport) {
  return editRoom(roomId, (doc, Yns) => {
    // The app stores the camera as a nested Y.Map (never a plain object).
    setRecord(Yns, doc.getMap("meta"), "savedViewport", viewport)
  })
}

/** Read the saved camera, or null. */
export function getViewport(roomId) {
  return editRoom(roomId, (doc) => doc.getMap("meta").get("savedViewport")?.toJSON?.() ?? null)
}

export function newId() {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789"
  return Array.from({ length: 21 }, () => a[(Math.random() * a.length) | 0]).join("")
}
