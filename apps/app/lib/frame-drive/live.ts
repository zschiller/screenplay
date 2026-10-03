import "server-only"

import { hostedChatDriver } from "@/lib/frame-drive/hosted/live"
import { macAgentDriver } from "@/lib/frame-drive/mac/live"
import { frameDriveRuntime } from "@/lib/frame-drive/runtime"
import { buildFrameDriveTools } from "@/lib/frame-drive/tools"
import { viewAgentDriver } from "@/lib/frame-drive/view/live"
import type { RoomDoc } from "@/lib/room-access"

/**
 * The Frame Drive tools for a chat. On the Mac (#1389) the agent drives any
 * frame or mockup in the asker's own canvas. On hosted it drives a frame's
 * one shared browser (#1396) and a mockup in the asker's view (#1391); a
 * deployment without shared frames drives mockups only.
 */
export function chatFrameDriveTools(opts: {
  room: RoomDoc
  userId: string
  sandboxName?: string
}) {
  const runtime = frameDriveRuntime()
  return buildFrameDriveTools(
    runtime === "mac"
      ? macAgentDriver(opts.room, opts.userId)
      : runtime === "shared"
        ? hostedChatDriver(opts.room, opts.userId)
        : viewAgentDriver(opts.room, opts.userId),
    opts.room,
    { kind: "chat", sandboxName: opts.sandboxName },
    { asker: opts.userId, frames: runtime !== null, files: runtime === "mac" }
  )
}
