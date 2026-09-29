import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { WebsocketProvider } from "y-websocket"
import { docs } from "y-websocket/bin/utils"
import * as Y from "yjs"
import { LOCAL_USER_ID } from "@/lib/local-user"
import { localWsSecret } from "@/lib/local-ws-guard"
import {
  getLocalYjsHost,
  startLocalYjsServer,
  type YjsServerHandle,
} from "@/lib/yjs-host/y-websocket-server"

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  { timeout = 3000, interval = 20 } = {}
): Promise<void> {
  const start = Date.now()
  for (;;) {
    if (await predicate()) return
    if (Date.now() - start > timeout) throw new Error("waitFor timed out")
    await new Promise((r) => setTimeout(r, interval))
  }
}

// The server's gate (#997): the app's own origin, carrying the secret.
const SECRET = "test-secret"
const APP_PORT = "3947"
const APP_ORIGIN = `http://127.0.0.1:${APP_PORT}`

/** A `ws` client that stamps an Origin, as the browser does for the page. */
function wsWithOrigin(origin: string) {
  return class extends WebSocket {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { origin })
    }
  }
}

/** Open a raw upgrade and resolve with the HTTP status it's refused with. */
function refusedStatus(url: string, origin?: string): Promise<number> {
  const ws = new WebSocket(url, origin ? { origin } : {})
  return new Promise((resolve, reject) => {
    // Aborting a refused handshake reports an error; the status is the result.
    ws.on("error", () => {})
    ws.on("unexpected-response", (_req, res) => {
      resolve(res.statusCode ?? 0)
      ws.terminate()
    })
    ws.on("open", () => {
      ws.close()
      reject(new Error("upgrade was accepted"))
    })
  })
}

describe("LocalYjsHost", () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "yjs-host-"))
    // The persistence singleton fixes its dir on first construction, so set
    // this before any host use.
    process.env.YJS_PERSISTENCE_DIR = dir
    // Binding a doc fires a fire-and-forget dynamic import of the layout watcher
    // (it pulls in the thumbnail → DB → drizzle stack). In a long-running sidecar
    // that resolves harmlessly, but here a bind late in a test can still be
    // loading those modules when Vitest tears the environment down — an
    // `EnvironmentTeardownError`. Preload the module graph up front so a late
    // bind resolves from cache instead of triggering a fresh load after teardown.
    await import("@/lib/thumbnail/local-layout-watcher")
  })

  afterAll(async () => {
    // Background debounced flushes can recreate files in `dir`; retry removal
    // so teardown doesn't race them.
    await rm(dir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 100,
    })
  })

  it("issues the per-launch secret as a token bound to the single local user", async () => {
    const { status, body } = await getLocalYjsHost().issueToken()
    expect(status).toBe(200)
    expect(JSON.parse(body).user.id).toBe(LOCAL_USER_ID)
    expect(JSON.parse(body).token).toBe(localWsSecret())
  })

  it("persists mutations and reloads them from disk (write, reload, same state)", async () => {
    const host = getLocalYjsHost()
    const room = "reload-room"

    await host.mutateDoc(room, (doc) => {
      doc.getMap("canvas").set("title", "persisted")
    })

    // Evict the in-memory doc to force the next access to reload from disk.
    const live = docs.get(room)
    if (live) {
      docs.delete(room)
      live.destroy()
    }

    const title = await host.readDoc(room, (doc) =>
      doc.getMap("canvas").get("title")
    )
    expect(title).toBe("persisted")
  })

  it("deleteRoom clears persisted state", async () => {
    const host = getLocalYjsHost()
    const room = "delete-room"
    await host.mutateDoc(room, (doc) => doc.getMap("m").set("a", 1))

    await host.deleteRoom(room)

    const value = await host.readDoc(room, (doc) => doc.getMap("m").get("a"))
    expect(value).toBeUndefined()
  })

  describe("over a live ws://localhost connection", () => {
    let server: YjsServerHandle
    const room = "liveroom"

    beforeAll(async () => {
      server = await startLocalYjsServer({
        port: 0,
        secret: SECRET,
        appPort: APP_PORT,
      })
    })

    afterAll(async () => {
      await server.close()
      // Let any disconnect-triggered + debounced (200ms) persistence flushes
      // settle before the outer afterAll removes the temp dir.
      await new Promise((r) => setTimeout(r, 350))
    })

    it("listens on loopback only", () => {
      expect(server.address).toBe("127.0.0.1")
    })

    it("refuses a foreign Origin, even with the secret", async () => {
      const url = `ws://127.0.0.1:${server.port}/${room}?token=${SECRET}`
      expect(await refusedStatus(url, "https://evil.example")).toBe(403)
      // Loopback on another port is another site (e.g. a prototype's preview).
      expect(await refusedStatus(url, "http://localhost:4000")).toBe(403)
    })

    it("refuses an upgrade with no Origin", async () => {
      const url = `ws://127.0.0.1:${server.port}/${room}?token=${SECRET}`
      expect(await refusedStatus(url)).toBe(403)
    })

    it("refuses the app's own Origin without the right secret", async () => {
      const base = `ws://127.0.0.1:${server.port}/${room}`
      expect(await refusedStatus(base, APP_ORIGIN)).toBe(401)
      expect(await refusedStatus(`${base}?token=wrong`, APP_ORIGIN)).toBe(401)
    })

    it("a connected peer and the server share one authoritative doc", async () => {
      const host = getLocalYjsHost()
      const clientDoc = new Y.Doc()
      const provider = new WebsocketProvider(
        `ws://localhost:${server.port}`,
        room,
        clientDoc,
        {
          WebSocketPolyfill: wsWithOrigin(APP_ORIGIN) as never,
          disableBc: true,
          params: { token: SECRET },
        }
      )

      try {
        await waitFor(() => provider.synced)

        // The server (sole Y.Doc writer for the Engine broadcast) writes; the
        // connected webview-style peer observes it.
        await host.mutateDoc(room, (doc) => {
          doc.getMap("canvas").set("title", "from-server")
        })
        await waitFor(
          () => clientDoc.getMap("canvas").get("title") === "from-server"
        )

        // A client edit commits back to the server's local doc.
        clientDoc.getMap("canvas").set("note", "from-client")
        await waitFor(
          async () =>
            (await host.readDoc(room, (doc) =>
              doc.getMap("canvas").get("note")
            )) === "from-client"
        )
      } finally {
        provider.destroy()
        clientDoc.destroy()
      }
    })

    it("a first client does not report synced until the room's disk state is loaded", async () => {
      const host = getLocalYjsHost()
      const coldRoom = "cold-room"
      await host.mutateDoc(coldRoom, (doc) => {
        doc.getMap("meta").set("savedViewport", "on-disk")
      })
      // Unload the room, as after its last peer disconnects, so the next
      // connection is the one that triggers the disk load.
      const live = docs.get(coldRoom)
      if (live) {
        docs.delete(coldRoom)
        live.destroy()
      }

      const clientDoc = new Y.Doc()
      const provider = new WebsocketProvider(
        `ws://localhost:${server.port}`,
        coldRoom,
        clientDoc,
        {
          WebSocketPolyfill: wsWithOrigin(APP_ORIGIN) as never,
          disableBc: true,
          params: { token: SECRET },
        }
      )
      let atSync: unknown = "never synced"
      provider.once("sync", () => {
        atSync = clientDoc.getMap("meta").get("savedViewport")
      })

      try {
        await waitFor(() => provider.synced)
        expect(atSync).toBe("on-disk")
      } finally {
        provider.destroy()
        clientDoc.destroy()
      }
    })
  })
})
