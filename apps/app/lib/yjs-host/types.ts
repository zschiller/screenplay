import "server-only"

import type * as Y from "yjs"

export type RoomRole = "owner" | "editor" | "viewer"

export type RoomMemberInput = {
  userId: string
  role: RoomRole
}

export type IssueTokenInput = {
  userId: string
  userInfo: { name: string; avatar?: string }
  roomId?: string
}

export type IssueTokenResult = {
  status: number
  body: string
}

/**
 * The server-facing surface of a Yjs host. A host provides:
 *   - room lifecycle (create/delete) and optional member sync,
 *   - server-side Y.Doc mutation,
 *   - token issuance for the client-side connect handshake.
 *
 * Implementations are interchangeable as long as the hosted Y.Doc remains
 * coherent across client/server peers — anything richer (presence, broadcast)
 * is layered on top via the Y.Doc itself.
 */
export interface YjsHost {
  /** Idempotent — called once per project on creation. */
  ensureRoom(opts: {
    roomId: string
    ownerId: string
    name: string
  }): Promise<void>

  deleteRoom(roomId: string): Promise<void>

  /**
   * Sync the room's member list. Hosts that enforce per-room ACLs use this
   * for defense in depth; auth is also gated at token issuance time.
   */
  syncRoomMembers(roomId: string, members: RoomMemberInput[]): Promise<void>

  updateRoomMetadata(roomId: string, metadata: { name?: string }): Promise<void>

  mutateDoc<T>(roomId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T>

  readDoc<T>(roomId: string, fn: (doc: Y.Doc) => T | Promise<T>): Promise<T>

  /**
   * Mint an auth token for the client-side connect handshake. The body is
   * sent verbatim to the client (Liveblocks expects a JWT envelope, etc.).
   */
  issueToken(input: IssueTokenInput): Promise<IssueTokenResult>
}
