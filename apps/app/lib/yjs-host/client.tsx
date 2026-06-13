/**
 * Re-exports the configured Yjs host's client surface. Build-time switch: the
 * desktop build sets `NEXT_PUBLIC_YJS_HOST=local` to select the local
 * y-websocket client; unset (the hosted deployment) keeps Liveblocks. The flag
 * is inlined by Next at build time, so the unused branch — and its import — is
 * tree-shaken out, leaving the hosted bundle unchanged. The matching server
 * surface flips on the same flag in `index.ts`.
 */
import {
  YjsRoomProvider as LiveblocksYjsRoomProvider,
  prewarmRoom as liveblocksPrewarmRoom,
} from "./liveblocks-client"
import {
  YjsRoomProvider as LocalYjsRoomProvider,
  prewarmRoom as localPrewarmRoom,
} from "./y-websocket-client"

const isLocal = process.env.NEXT_PUBLIC_YJS_HOST === "local"

export const YjsRoomProvider = isLocal
  ? LocalYjsRoomProvider
  : LiveblocksYjsRoomProvider

/**
 * Open a room's connection ahead of navigation so the canvas renders on the
 * first frame. Real on the local desktop host; a no-op on the hosted build.
 */
export const prewarmRoom = isLocal ? localPrewarmRoom : liveblocksPrewarmRoom
