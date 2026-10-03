import "server-only"

import { frameControlKey } from "@/lib/canvas/frame-control"
import { AgentFrameDriver } from "@/lib/frame-drive/agent-driver"
import {
  macAskerCanvas,
  macFrameDriveBackend,
  type NativeSnapshot,
} from "@/lib/frame-drive/mac/channel"
import { encodeShot, roomFrameControlStore } from "@/lib/frame-drive/server"
import type { RoomDoc } from "@/lib/room-access"
import { TAURI_CONTROL_URL_ENV_VAR } from "@/lib/thumbnail/capturer/tauri-webview"

/** The per-launch token the Mac shell's control server wants for a snapshot
 *  of the canvas window. */
export const TAURI_CONTROL_TOKEN_ENV_VAR = "TAURI_CONTROL_TOKEN"

// One driver per Room and asker for the process: it remembers which frames
// the agent holds between tool calls. On globalThis because the in-process
// turn and the harness MCP route can load this module in separate graphs.
const DRIVERS_KEY = Symbol.for("screenplay.macAgentFrameDrivers")
type DriversHost = typeof globalThis & {
  [DRIVERS_KEY]?: Map<string, AgentFrameDriver>
}

/**
 * The agent's driver for one asker on the Mac (#1389): it drives frames and
 * mockups (#1391) in the asker's own canvas, through Frame Control's record
 * for their copy.
 */
export function macAgentDriver(
  room: RoomDoc,
  userId: string
): AgentFrameDriver {
  const host = globalThis as DriversHost
  const drivers = (host[DRIVERS_KEY] ??= new Map())
  const key = `${room.roomId}:${userId}`
  let driver = drivers.get(key)
  if (!driver) {
    const canvas = macAskerCanvas(room.roomId)
    driver = new AgentFrameDriver({
      backend: macFrameDriveBackend(room.roomId, {
        snapshot: shellSnapshot,
        encode: encodeShot,
      }),
      store: roomFrameControlStore(room),
      keyOf: (frameId) => frameControlKey(frameId, userId),
      // On the Mac the only parties are the person and the agent.
      presence: () => ({ online: new Set([userId]), goneAt: new Map() }),
      reveal: (frameId) => canvas.reveal(frameId),
    })
    drivers.set(key, driver)
  }
  return driver
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
