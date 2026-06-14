import "server-only"

import http from "node:http"
import path from "node:path"
import { WebSocketServer } from "ws"
import * as Y from "yjs"
import {
  docs,
  getYDoc,
  setPersistence,
  setupWSConnection,
} from "y-websocket/bin/utils"
import { LOCAL_USER } from "@/lib/local-user"
import { FileYjsPersistence } from "@/lib/yjs-host/file-persistence"
import type { IssueTokenResult, YjsHost } from "@/lib/yjs-host/types"

const DEFAULT_PORT = 1234

function persistenceDir(): string {
  return (
    process.env.YJS_PERSISTENCE_DIR ?? path.join(process.cwd(), ".data", "yjs")
  )
}

export function yjsWebsocketPort(): number {
  // Same flag the client connects with, so both ends stay in lockstep.
  const raw = process.env.NEXT_PUBLIC_YJS_WS_PORT
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) ? parsed : DEFAULT_PORT
}

/**
 * Process-wide setup shared by the in-process host (which reads/mutates the
 * authoritative doc) and the WebSocket server (which serves it to the webview).
 * Both go through y-websocket's `docs` registry, so they operate on the *same*
 * `Y.Doc` instance per room — the server stays the sole Y.Doc peer that writes
 * the Engine's broadcast (ADR 0006), and the browser is a pure consumer.
 *
 * Holding the persistence instance here (not just handing it to
 * `setPersistence`) lets the host await the disk load before reading/mutating
 * and force a durable flush after a mutation.
 */
let persistence: FileYjsPersistence | null = null
function ensureConfigured(): FileYjsPersistence {
  if (persistence) return persistence
  persistence = new FileYjsPersistence(persistenceDir())
  // The sidecar holds the authoritative doc, so it — not the client — keeps the
  // thumbnail's layout fresh: watch each room's doc and rebuild the manifest's
  // rects when the canvas changes. Removes the client heartbeat's layout lane
  // and its fragile flush-on-navigate (the capture lane stays client-driven).
  //
  // Imported lazily (not at module top) to break an import cycle: the watcher
  // pulls in the thumbnail capture stack, which transitively re-enters
  // `@/lib/yjs-host` and calls `getLocalYjsHost()` while this module is still
  // evaluating — hitting `cached`'s temporal dead zone. The hook only fires at
  // runtime, long after evaluation settles, so deferring the import is safe.
  // The watcher self-detaches on doc destroy, so its return value is unused.
  persistence.onBindDoc = (docName, ydoc) => {
    void import("@/lib/thumbnail/local-layout-watcher").then(
      ({ watchLocalRoomLayout }) => watchLocalRoomLayout(docName, ydoc)
    )
  }
  setPersistence(persistence)
  return persistence
}

/**
 * The local Yjs host. The sidecar holds the authoritative Y.Doc in-process and
 * persists it to disk; the webview connects over `ws://localhost`. Replaces the
 * Liveblocks transport while keeping the Y.Doc data model untouched.
 *
 * Multi-user concerns the Liveblocks host carried (room ACLs, member sync,
 * presence-scoped tokens) collapse to no-ops here: the local app is single-user
 * (PRD #404). Room *metadata* (name, owner) lives in Postgres, not in the
 * transport, so the room-lifecycle methods don't need to touch the host.
 */
class LocalYjsHost implements YjsHost {
  private readonly persistence: FileYjsPersistence

  constructor() {
    this.persistence = ensureConfigured()
  }

  /** Resolve a room's authoritative doc, with its disk state loaded. */
  private async getDoc(roomId: string) {
    const doc = getYDoc(roomId)
    await this.persistence.whenLoaded(roomId)
    return doc
  }

  // Rooms are created lazily on first access and their metadata lives in
  // Postgres, so there is nothing to provision in the transport.
  async ensureRoom(): Promise<void> {}

  async deleteRoom(roomId: string): Promise<void> {
    const existing = docs.get(roomId)
    if (existing) {
      docs.delete(roomId)
      existing.destroy()
    }
    await this.persistence.deleteRoom(roomId)
  }

  // Single local user: no per-room ACLs or metadata to mirror into the host.
  async syncRoomMembers(): Promise<void> {}
  async updateRoomMetadata(): Promise<void> {}

  async mutateDoc<T>(
    roomId: string,
    fn: (doc: Y.Doc) => T | Promise<T>
  ): Promise<T> {
    const doc = await this.getDoc(roomId)
    const result = await fn(doc)
    // Make the write durable before returning so callers (and reloads) can
    // rely on it, rather than waiting for the debounced flush.
    await this.persistence.flush(roomId, doc)
    return result
  }

  async readDoc<T>(
    roomId: string,
    fn: (doc: Y.Doc) => T | Promise<T>
  ): Promise<T> {
    const doc = await this.getDoc(roomId)
    return fn(doc)
  }

  /**
   * The local webview connects straight to `ws://localhost` and needs no
   * token, but the seam still issues one bound to the single local user so the
   * `/api/yjs/auth` contract holds.
   */
  async issueToken(): Promise<IssueTokenResult> {
    return {
      status: 200,
      body: JSON.stringify({
        token: "local",
        user: { id: LOCAL_USER.id, name: LOCAL_USER.name },
      }),
    }
  }
}

let cached: LocalYjsHost | null = null
export function getLocalYjsHost(): LocalYjsHost {
  if (!cached) cached = new LocalYjsHost()
  return cached
}

/**
 * Start the y-websocket server that serves the authoritative docs to the
 * webview. Booted once from `instrumentation.ts` in local mode. Idempotent and
 * test-friendly: pass `port: 0` for an ephemeral port and use the returned
 * handle to read the bound port / shut down.
 */
export interface YjsServerHandle {
  port: number
  close: () => Promise<void>
}

let serverHandle: YjsServerHandle | null = null

export async function startLocalYjsServer(
  opts: { port?: number } = {}
): Promise<YjsServerHandle> {
  if (serverHandle) return serverHandle

  ensureConfigured()
  const requestedPort = opts.port ?? yjsWebsocketPort()

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end("ok")
  })
  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", (conn, req) => setupWSConnection(conn, req))
  server.on("upgrade", (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (conn) => {
      wss.emit("connection", conn, req)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(requestedPort, () => {
      server.off("error", reject)
      resolve()
    })
  })

  const address = server.address()
  const port =
    typeof address === "object" && address ? address.port : requestedPort

  serverHandle = {
    port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss.close()
        server.close((err) => (err ? reject(err) : resolve()))
        serverHandle = null
      }),
  }
  return serverHandle
}
