import "server-only"

import http, { type IncomingMessage } from "node:http"
import path from "node:path"
import { type RawData, WebSocket, WebSocketServer } from "ws"
import * as Y from "yjs"
import {
  docs,
  getPersistence,
  getYDoc,
  setPersistence,
  setupWSConnection,
} from "y-websocket/bin/utils"
import { LOCAL_USER } from "@/lib/local-user"
import {
  checkLocalUpgrade,
  type GuardOptions,
  localWsSecret,
  rejectUpgrade,
} from "@/lib/local-ws-guard"
import { acceptFrameDriveConnection } from "@/lib/frame-drive/mac/channel"
import { FRAME_DRIVE_PATH } from "@/lib/frame-drive/canvas/protocol"
import { FileYjsPersistence } from "@/lib/yjs-host/file-persistence"
import {
  type ViewerPresencePerson,
  viewerMessageFilter,
} from "@/lib/yjs-host/viewer-messages"
import { setViewerYjs } from "@/server/ws-routes.mjs"
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

/** A `FileYjsPersistence`, from any copy of its module (`instanceof` is per copy). */
function isFilePersistence(value: unknown): value is FileYjsPersistence {
  return (
    typeof value === "object" &&
    value !== null &&
    "whenLoaded" in value &&
    typeof value.whenLoaded === "function"
  )
}

function ensureConfigured(): FileYjsPersistence {
  if (persistence) return persistence
  // Next evaluates this module more than once per process (instrumentation,
  // which starts the WebSocket server, and the route bundles each get a copy),
  // but y-websocket's registry is shared by all of them. Adopt the persistence
  // another copy registered: replacing it would leave the docs it already bound
  // tracked by an instance whose `whenLoaded` nobody asks, and the WebSocket
  // gate would answer a room's first peer with an empty doc.
  const registered = getPersistence()
  if (isFilePersistence(registered)) {
    persistence = registered
    return persistence
  }
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
   * The token is the sidecar's per-launch secret: the webview presents it on
   * its `ws://localhost` connection and the server refuses any upgrade without
   * it (#997). Bound to the single local user, as the `/api/yjs/auth` contract
   * expects.
   */
  async issueToken(): Promise<IssueTokenResult> {
    return {
      status: 200,
      body: JSON.stringify({
        token: localWsSecret(),
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
 *
 * It listens on loopback only and accepts an upgrade only from the app's own
 * origin carrying the per-launch secret (`lib/local-ws-guard.ts`, #997). The
 * same gate covers the Mac drive channel on {@link FRAME_DRIVE_PATH}.
 */
export interface YjsServerHandle {
  port: number
  /** The bound address; always loopback. */
  address: string
  close: () => Promise<void>
}

let serverHandle: YjsServerHandle | null = null

/**
 * Hand a connection to y-websocket only once its room's disk state is loaded.
 * y-websocket binds persistence without awaiting it and answers the client's
 * sync step 1 at once, so the first peer of an unloaded room would otherwise
 * report `synced` against an empty doc and write concurrently with, rather
 * than on top of, the persisted state (#769). Messages the client sends while
 * we wait are buffered and replayed so its sync step 1 isn't dropped.
 */
async function connectWhenLoaded(
  conn: WebSocket,
  req: IncomingMessage,
  {
    // Same room-name derivation `setupWSConnection` uses by default.
    docName = (req.url ?? "").slice(1).split("?")[0]!,
    viewer,
  }: { docName?: string; viewer?: ViewerPresencePerson } = {}
): Promise<void> {
  const buffered: [RawData, boolean][] = []
  const buffer = (data: RawData, isBinary: boolean) =>
    buffered.push([data, isBinary])
  conn.on("message", buffer)

  try {
    // Creating the doc binds persistence, which starts the disk load.
    getYDoc(docName)
    await ensureConfigured().whenLoaded(docName)
  } catch (err) {
    console.warn(`yjs-host: failed to load room ${docName}`, err)
    conn.close()
    return
  } finally {
    conn.off("message", buffer)
  }
  // The client may have gone away while the room loaded.
  if (conn.readyState !== WebSocket.OPEN) return

  setupWSConnection(conn, req, { docName })
  if (viewer) readOnly(conn, docName, viewer)
  for (const [data, isBinary] of buffered) conn.emit("message", data, isBinary)
}

/**
 * Put a viewer's socket behind {@link viewerMessageFilter} (#1932): y-websocket's
 * own message listener only ever sees what a viewer may send, so the doc
 * never takes a viewer's change.
 */
function readOnly(
  conn: WebSocket,
  docName: string,
  person: ViewerPresencePerson
): void {
  const filter = viewerMessageFilter({
    person,
    heldElsewhere: (clientId) => {
      for (const [other, ids] of docs.get(docName)?.conns ?? []) {
        if (other !== conn && ids.has(clientId)) return true
      }
      return false
    },
  })
  const listeners = conn.listeners("message") as Array<
    (data: RawData, isBinary: boolean) => void
  >
  conn.removeAllListeners("message")
  conn.on("message", (data: RawData, isBinary: boolean) => {
    const passed = filter(toBytes(data))
    if (!passed) return
    const out = Buffer.from(passed.buffer, passed.byteOffset, passed.byteLength)
    for (const listener of listeners) listener.call(conn, out, isBinary)
  })
}

function toBytes(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data))
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
}

/** Whether a canvas is still there, so a link to a deleted one finds nothing. */
async function roomExists(roomId: string): Promise<boolean> {
  // Lazily: the rooms module pulls in the database, which this one otherwise
  // never needs.
  const { getRoom } = await import("@/lib/rooms")
  return (await getRoom(roomId)) !== null
}

export async function startLocalYjsServer(
  opts: {
    port?: number
    /** Whether a viewer's canvas exists; the rooms table by default. */
    viewerRoomExists?: (roomId: string) => Promise<boolean>
  } & GuardOptions = {}
): Promise<YjsServerHandle> {
  if (serverHandle) return serverHandle

  ensureConfigured()
  const requestedPort = opts.port ?? yjsWebsocketPort()

  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" })
    res.end("ok")
  })
  const wss = new WebSocketServer({ noServer: true })
  wss.on("connection", (conn, req) => void connectWhenLoaded(conn, req))
  // A viewer's socket (Sharing, #1932) arrives from the front server's viewer
  // listener, already checked there, and is read-only plus presence.
  // A link to a deleted canvas opens nothing, rather than an empty doc.
  const viewerWss = new WebSocketServer({ noServer: true })
  const viewerRoomExists = opts.viewerRoomExists ?? roomExists
  setViewerYjs((req, socket, head, { roomId, person }) => {
    viewerRoomExists(roomId).then(
      (exists) => {
        if (!exists) return rejectUpgrade(socket, 404)
        viewerWss.handleUpgrade(req, socket, head, (conn) => {
          void connectWhenLoaded(conn, req, { docName: roomId, viewer: person })
        })
      },
      (err: unknown) => {
        console.warn(`yjs-host: couldn’t look up room ${roomId}`, err)
        rejectUpgrade(socket, 500)
      }
    )
  })
  // The Mac drive channel (#1389) shares the port and the gate.
  const driveWss = new WebSocketServer({ noServer: true })
  driveWss.on("connection", acceptFrameDriveConnection)
  server.on("upgrade", (req, socket, head) => {
    const refused = checkLocalUpgrade(req, opts)
    if (refused) return rejectUpgrade(socket, refused)
    const { pathname } = new URL(req.url ?? "/", "http://localhost")
    const target = pathname === FRAME_DRIVE_PATH ? driveWss : wss
    target.handleUpgrade(req, socket, head, (conn) => {
      target.emit("connection", conn, req)
    })
  })

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(requestedPort, "127.0.0.1", () => {
      server.off("error", reject)
      resolve()
    })
  })

  const bound = server.address()
  const port = typeof bound === "object" && bound ? bound.port : requestedPort
  const address =
    typeof bound === "object" && bound ? bound.address : "127.0.0.1"

  serverHandle = {
    port,
    address,
    close: () =>
      new Promise<void>((resolve, reject) => {
        wss.close()
        driveWss.close()
        viewerWss.close()
        setViewerYjs(undefined)
        server.close((err) => (err ? reject(err) : resolve()))
        serverHandle = null
      }),
  }
  return serverHandle
}
