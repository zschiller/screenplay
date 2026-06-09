/**
 * Re-exports the configured Yjs host's client surface. Build-time switch: the
 * desktop build sets `NEXT_PUBLIC_YJS_HOST=local` to select the local
 * y-websocket client; unset (the hosted deployment) keeps Liveblocks. The flag
 * is inlined by Next at build time, so the unused branch — and its import — is
 * tree-shaken out, leaving the hosted bundle unchanged. The matching server
 * surface flips on the same flag in `index.ts`.
 */
import { YjsRoomProvider as LiveblocksYjsRoomProvider } from "./liveblocks-client"
import { YjsRoomProvider as LocalYjsRoomProvider } from "./y-websocket-client"

export const YjsRoomProvider =
  process.env.NEXT_PUBLIC_YJS_HOST === "local"
    ? LocalYjsRoomProvider
    : LiveblocksYjsRoomProvider
