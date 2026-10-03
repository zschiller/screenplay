import "server-only"

import { macAgentDriver } from "@/lib/frame-drive/mac/live"
import { buildFrameDriveTools } from "@/lib/frame-drive/tools"
import { viewAgentDriver } from "@/lib/frame-drive/view/live"
import { isLocalBuild } from "@/lib/local-mode"
import type { RoomDoc } from "@/lib/room-access"

/**
 * The Frame Drive tools for a chat. The agent drives in the asker's own
 * canvas: Frame Control's record for their copy. On the Mac (#1389) that's
 * any frame or mockup; on hosted, mockups only (#1391), since a frame there is
 * one shared browser whose backend is #1396.
 */
export function chatFrameDriveTools(opts: {
  room: RoomDoc
  userId: string
  sandboxName?: string
}) {
  return buildFrameDriveTools(
    isLocalBuild
      ? macAgentDriver(opts.room, opts.userId)
      : viewAgentDriver(opts.room, opts.userId),
    opts.room,
    { kind: "chat", sandboxName: opts.sandboxName },
    { asker: opts.userId, frames: isLocalBuild }
  )
}
