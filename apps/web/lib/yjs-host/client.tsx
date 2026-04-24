/**
 * Re-exports the configured Yjs host's client surface. Swapping hosts means
 * pointing this single import at a different sibling file (e.g.
 * `./hocuspocus-client`, `./y-websocket-client`). Mirrors the
 * `lib/db/index.ts` → `lib/db/neon.ts` pattern on the server.
 */
export { YjsRoomProvider } from "./liveblocks-client"
