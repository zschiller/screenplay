import "server-only"

import { Liveblocks } from "@liveblocks/node"

type UpdateAccesses = Record<
  string,
  ["room:write"] | ["room:read", "room:presence:write"] | null
>
import * as Y from "yjs"
import type {
  IssueTokenInput,
  IssueTokenResult,
  RoomMemberInput,
  YjsHost,
} from "@/lib/yjs-host/types"

class LiveblocksYjsHost implements YjsHost {
  private readonly client: Liveblocks

  constructor(secret: string) {
    this.client = new Liveblocks({ secret })
  }

  async ensureRoom(opts: {
    roomId: string
    ownerId: string
    name: string
  }): Promise<void> {
    try {
      await this.client.createRoom(opts.roomId, {
        defaultAccesses: [],
        usersAccesses: { [opts.ownerId]: ["room:write"] },
        metadata: { name: opts.name, ownerId: opts.ownerId },
      })
    } catch (err) {
      // The Liveblocks SDK throws on conflicts (room already exists). Treat
      // ensureRoom as idempotent so callers can blindly invoke it.
      const status = (err as { status?: number })?.status
      if (status !== 409) throw err
    }
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.client.deleteRoom(roomId)
  }

  async syncRoomMembers(
    roomId: string,
    members: RoomMemberInput[],
  ): Promise<void> {
    // Liveblocks `updateRoom` MERGES `usersAccesses`. To make this method
    // declarative ("after this call, the room has exactly these members"),
    // diff against current state and explicitly null out removals.
    const room = await this.client.getRoom(roomId)
    const usersAccesses: UpdateAccesses = {}

    const next = new Set<string>()
    for (const m of members) {
      next.add(m.userId)
      usersAccesses[m.userId] =
        m.role === "viewer" ? ["room:read", "room:presence:write"] : ["room:write"]
    }
    for (const existingId of Object.keys(room.usersAccesses)) {
      if (!next.has(existingId)) usersAccesses[existingId] = null
    }
    await this.client.updateRoom(roomId, { usersAccesses })
  }

  async updateRoomMetadata(
    roomId: string,
    metadata: { name?: string },
  ): Promise<void> {
    await this.client.updateRoom(roomId, { metadata })
  }

  async mutateDoc<T>(
    roomId: string,
    fn: (doc: Y.Doc) => T | Promise<T>,
  ): Promise<T> {
    const initial = await this.client.getYjsDocumentAsBinaryUpdate(roomId)
    const doc = new Y.Doc()
    if (initial.byteLength > 0) Y.applyUpdate(doc, new Uint8Array(initial))
    const beforeSV = Y.encodeStateVector(doc)
    let result: T
    try {
      result = await fn(doc)
    } finally {
      const diff = Y.encodeStateAsUpdate(doc, beforeSV)
      try {
        if (diff.byteLength > 0) {
          await this.client.sendYjsBinaryUpdate(roomId, diff)
        }
      } finally {
        doc.destroy()
      }
    }
    return result
  }

  async readDoc<T>(
    roomId: string,
    fn: (doc: Y.Doc) => T | Promise<T>,
  ): Promise<T> {
    const initial = await this.client.getYjsDocumentAsBinaryUpdate(roomId)
    const doc = new Y.Doc()
    if (initial.byteLength > 0) Y.applyUpdate(doc, new Uint8Array(initial))
    try {
      return await fn(doc)
    } finally {
      doc.destroy()
    }
  }

  async issueToken(input: IssueTokenInput): Promise<IssueTokenResult> {
    const { status, body } = await this.client.identifyUser(
      { userId: input.userId, groupIds: [] },
      { userInfo: input.userInfo },
    )
    return { status, body }
  }

  /**
   * Liveblocks-specific escape hatch — exposed for the one-shot backfill of
   * pre-Postgres rooms. Other consumers go through the YjsHost interface.
   */
  rawClient(): Liveblocks {
    return this.client
  }
}

let cached: LiveblocksYjsHost | null = null
export function getLiveblocksHost(): LiveblocksYjsHost {
  if (cached) return cached
  const secret = process.env.LIVEBLOCKS_SECRET_KEY
  if (!secret) throw new Error("LIVEBLOCKS_SECRET_KEY is not set")
  cached = new LiveblocksYjsHost(secret)
  return cached
}
