import "server-only"

import sharp from "sharp"

import {
  EMPTY_FRAME_CONTROL,
  frameControlKey,
} from "@/lib/canvas/frame-control"
import {
  AgentFrameDriver,
  type FrameControlStore,
} from "@/lib/frame-drive/agent-driver"
import {
  macFrameDriveBackend,
  type NativeSnapshot,
} from "@/lib/frame-drive/mac/channel"
import { buildFrameDriveTools } from "@/lib/frame-drive/tools"
import { isLocalBuild } from "@/lib/local-mode"
import type { RoomDoc } from "@/lib/room-access"
import { TAURI_CONTROL_URL_ENV_VAR } from "@/lib/thumbnail/capturer/tauri-webview"

/** The per-launch token the Mac shell's control server wants for a snapshot
 *  of the canvas window. */
export const TAURI_CONTROL_TOKEN_ENV_VAR = "TAURI_CONTROL_TOKEN"

/** Longest side of a screenshot, as `view_frame`'s. */
const MAX_SHOT_DIM = 1280

/**
 * The Frame Drive tools for a chat on the Mac (#1389), or none on hosted
 * (whose backend is #1396). The agent drives the frame in the asker's own
 * canvas: Frame Control's record for their copy of it.
 */
export function chatFrameDriveTools(opts: {
  room: RoomDoc
  userId: string
  sandboxName?: string
}) {
  if (!isLocalBuild) return {}
  return buildFrameDriveTools(
    macAgentDriver(opts.room, opts.userId),
    opts.room,
    {
      kind: "chat",
      sandboxName: opts.sandboxName,
    }
  )
}

// One driver per Room and asker for the process: it remembers which frames
// the agent holds between tool calls. On globalThis because the in-process
// turn and the harness MCP route can load this module in separate graphs.
const DRIVERS_KEY = Symbol.for("screenplay.macAgentFrameDrivers")
type DriversHost = typeof globalThis & {
  [DRIVERS_KEY]?: Map<string, AgentFrameDriver>
}

function macAgentDriver(room: RoomDoc, userId: string): AgentFrameDriver {
  const host = globalThis as DriversHost
  const drivers = (host[DRIVERS_KEY] ??= new Map())
  const key = `${room.roomId}:${userId}`
  let driver = drivers.get(key)
  if (!driver) {
    driver = new AgentFrameDriver({
      backend: macFrameDriveBackend(room.roomId, {
        snapshot: shellSnapshot,
        encode: encodeShot,
      }),
      store: roomFrameControlStore(room),
      keyOf: (frameId) => frameControlKey(frameId, userId),
      // On the Mac the only parties are the person and the agent.
      presence: () => ({ online: new Set([userId]), goneAt: new Map() }),
    })
    drivers.set(key, driver)
  }
  return driver
}

function roomFrameControlStore(room: RoomDoc): FrameControlStore {
  return {
    update: (key, fn) =>
      room.mutateDoc((c) => {
        const current = c.frameControl.get(key)
        const next = fn(current ?? EMPTY_FRAME_CONTROL)
        if (next === current) return next
        // A record nobody drives or waits on says nothing; don't keep it.
        if (next.driver === null && next.requests.length === 0) {
          if (current) c.frameControl.delete(key)
        } else {
          c.frameControl.set(key, next)
        }
        return next
      }),
  }
}

/** The Mac shell's snapshot of the canvas window, limited to `rect`. */
const shellSnapshot: NativeSnapshot = async (rect) => {
  const controlUrl = process.env[TAURI_CONTROL_URL_ENV_VAR]
  if (!controlUrl) throw new Error("the desktop shell isn't running")
  const res = await fetch(new URL("/snapshot-main", controlUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-screenplay-control-token":
        process.env[TAURI_CONTROL_TOKEN_ENV_VAR] ?? "",
    },
    body: JSON.stringify(rect),
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) {
    throw new Error(
      (await res.text().catch(() => "")) || `status ${res.status}`
    )
  }
  return Buffer.from(await res.arrayBuffer())
}

async function encodeShot(
  png: Buffer,
  size: { width: number; height: number }
): Promise<{ data: Buffer; mediaType: string }> {
  const scale = Math.min(1, MAX_SHOT_DIM / Math.max(size.width, size.height))
  const data = await sharp(png)
    .resize(
      Math.max(1, Math.round(size.width * scale)),
      Math.max(1, Math.round(size.height * scale)),
      { fit: "fill" }
    )
    .webp({ quality: 85 })
    .toBuffer()
  return { data, mediaType: "image/webp" }
}
