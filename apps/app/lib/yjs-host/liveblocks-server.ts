import "server-only"

import { Liveblocks, WebhookHandler } from "@liveblocks/node"

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
  // Lazily built from `LIVEBLOCKS_WEBHOOK_SECRET` the first time a webhook
  // arrives; absent when the secret isn't configured (webhooks disabled).
  private webhooks: WebhookHandler | null = null

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
    members: RoomMemberInput[]
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
        m.role === "viewer"
          ? ["room:read", "room:presence:write"]
          : ["room:write"]
    }
    for (const existingId of Object.keys(room.usersAccesses)) {
      if (!next.has(existingId)) usersAccesses[existingId] = null
    }
    await this.client.updateRoom(roomId, { usersAccesses })
  }

  async updateRoomMetadata(
    roomId: string,
    metadata: { name?: string }
  ): Promise<void> {
    await this.client.updateRoom(roomId, { metadata })
  }

  async mutateDoc<T>(
    roomId: string,
    fn: (doc: Y.Doc) => T | Promise<T>
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
    fn: (doc: Y.Doc) => T | Promise<T>
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
      { userInfo: input.userInfo }
    )
    return { status, body }
  }

  /**
   * Handle Liveblocks' `ydocUpdated` webhook: verify the signature, then rebuild
   * the room's thumbnail layout server-side. This is how the hosted build keeps
   * thumbnails fresh without depending on a canvas client to phone home — the
   * webhook fires on any doc change, including edits made by an AI agent with no
   * editor open. Liveblocks throttles `ydocUpdated` (at most once every few
   * seconds per room), and the rebuild is idempotent, so handling each delivery
   * inline is cheap and safe.
   *
   * Configure a webhook on the Liveblocks dashboard pointing at
   * `/api/liveblocks/webhook` and set its signing secret as
   * `LIVEBLOCKS_WEBHOOK_SECRET`. Without the secret this returns 501 and the
   * hosted build falls back to the client heartbeat's layout lane.
   */
  async handleDocChangeWebhook(req: Request): Promise<Response> {
    const secret = process.env.LIVEBLOCKS_WEBHOOK_SECRET
    if (!secret) {
      return new Response("LIVEBLOCKS_WEBHOOK_SECRET not configured", {
        status: 501,
      })
    }
    if (!this.webhooks) this.webhooks = new WebhookHandler(secret)

    const rawBody = await req.text()
    let event: ReturnType<WebhookHandler["verifyRequest"]>
    try {
      event = this.webhooks.verifyRequest({ headers: req.headers, rawBody })
    } catch {
      // A failed verification is an unsigned/forged request — reject it.
      return new Response("Invalid webhook signature", { status: 400 })
    }

    if (event.type === "ydocUpdated") {
      // Lazy import breaks the cycle: rebuild → capture → yjs/server →
      // yjs-host (this module). The import resolves at call time, long after
      // module evaluation has settled.
      const { rebuildRoomLayoutThumbnail } = await import(
        "@/lib/thumbnail/rebuild-layout"
      )
      try {
        await rebuildRoomLayoutThumbnail(event.data.roomId)
      } catch (err) {
        // 5xx so Liveblocks retries the delivery rather than dropping the edit.
        console.error("[thumbnail] webhook layout rebuild failed", err)
        return new Response("Rebuild failed", { status: 500 })
      }
    }

    return new Response(null, { status: 200 })
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
