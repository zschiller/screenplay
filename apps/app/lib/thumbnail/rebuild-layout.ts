import "server-only"

import { captureRoomThumbnail } from "./capture"

/**
 * Rebuild a Room's thumbnail *layout* (the manifest's rects/labels/palette) from
 * the authoritative Y.Doc — the cheap lane: a doc read + a manifest write, no
 * browser. The single provider-agnostic entry point both server-side triggers
 * call so neither depends on a canvas client being open:
 *
 *  - the local host's in-process doc observer (`y-websocket-server.ts`), and
 *  - the hosted Liveblocks `ydocUpdated` webhook (`handleDocChangeWebhook`).
 *
 * Idempotent: `captureRoomThumbnail` skips the write (and the revision bump) when
 * the layout is unchanged, so a trigger that fires on *any* doc change — the
 * webhook can't distinguish a frame move from a chat-stream write — doesn't
 * thrash the home grid's poll. Frame *captures* (the expensive screenshots) stay
 * client-driven via the heartbeat's capture lane; the server can't know when an
 * iframe's content has settled.
 */
export async function rebuildRoomLayoutThumbnail(roomId: string): Promise<void> {
  await captureRoomThumbnail(roomId, undefined, { frameIds: [] })
}
