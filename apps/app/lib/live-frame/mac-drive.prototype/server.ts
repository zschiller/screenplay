// PROTOTYPE (#1367) — throwaway. The server half of the Mac drive relay:
// agent → this module → Yjs awareness → the canvas client → postMessage → the
// frame's Sandbox Bridge, and the answer back over a plain POST.
import "server-only"

import { randomUUID } from "node:crypto"
import { getYDoc } from "y-websocket/bin/utils"

type Awareness = {
  setLocalState(state: unknown): void
}
type SharedDoc = { awareness: Awareness; conns: Map<unknown, unknown> }

type Pending = {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  timer: ReturnType<typeof setTimeout>
}

// On globalThis so the route handler's module instance and any other share it
// across `next dev` recompiles.
const g = globalThis as unknown as { __macDrivePending?: Map<string, Pending> }
const pending = (g.__macDrivePending ??= new Map())

export type DriveTimings = {
  /** Server published the op on awareness. */
  tPublish: number
  /** Server got the client's answer. */
  tAnswer: number
}

/**
 * Send one bridge message to a frame in the user's open canvas and wait for
 * the bridge's answer. `message` is any `screenplay:*` request the bridge
 * answers with a `dom-result` (the new `screenplay:drive` ops, or an existing
 * `screenplay:dom-query` read). `frameId: "__client"` addresses the canvas
 * client itself (frame rects, for the native snapshot).
 */
export async function relayToFrame(
  roomId: string,
  frameId: string,
  message: Record<string, unknown>,
  timeoutMs = 8000
): Promise<{ value: unknown; client: unknown; timings: DriveTimings }> {
  const doc = getYDoc(roomId) as unknown as SharedDoc
  if (doc.conns.size === 0) {
    throw new Error("nobody has this canvas open, so there is no frame to drive")
  }
  const id = randomUUID()
  const tPublish = Date.now()
  const answered = new Promise<{ value: unknown; client: unknown }>(
    (resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        reject(new Error("the canvas client didn't answer in time"))
      }, timeoutMs)
      pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        timer,
      })
    }
  )
  // The server is a silent awareness peer (y-websocket's shared doc starts
  // with a null state). It speaks only for the length of one op; the canvas's
  // presence code ignores states with no `identity`.
  doc.awareness.setLocalState({ macDrive: { id, frameId, message, tPublish } })
  try {
    const { value, client } = await answered
    return { value, client, timings: { tPublish, tAnswer: Date.now() } }
  } finally {
    doc.awareness.setLocalState(null)
  }
}

export function answerRelay(
  id: string,
  result: { ok: boolean; value?: unknown; error?: string; client?: unknown }
): boolean {
  const p = pending.get(id)
  if (!p) return false
  pending.delete(id)
  clearTimeout(p.timer)
  if (result.ok) p.resolve({ value: result.value, client: result.client })
  else p.reject(new Error(result.error || "bridge error"))
  return true
}

/**
 * The frame as the user sees it right now: ask the client where the iframe is
 * in the main webview, then have the Tauri shell `takeSnapshot` that rect.
 */
export async function snapshotFrame(roomId: string, frameId: string) {
  const controlUrl = process.env.TAURI_CONTROL_URL
  if (!controlUrl) throw new Error("no Tauri shell (TAURI_CONTROL_URL unset)")
  const t0 = Date.now()
  const { value } = await relayToFrame(roomId, "__client", {
    type: "client:frame-rect",
    frameId,
  })
  const where = value as {
    rect: { x: number; y: number; width: number; height: number } | null
    zoom: number
    window: { width: number; height: number }
    visibility: string
  }
  const tRect = Date.now()
  const res = await fetch(new URL("/snapshot-main", controlUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: where.rect ? JSON.stringify(where.rect) : "",
  })
  if (!res.ok) throw new Error(`shell snapshot failed: ${await res.text()}`)
  const png = Buffer.from(await res.arrayBuffer())
  return { png, where, ms: { rect: tRect - t0, snapshot: Date.now() - tRect } }
}
