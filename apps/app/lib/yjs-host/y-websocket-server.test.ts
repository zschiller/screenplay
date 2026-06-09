import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { WebSocket } from "ws"
import { WebsocketProvider } from "y-websocket"
import { docs } from "y-websocket/bin/utils"
import * as Y from "yjs"
import { LOCAL_USER_ID } from "@/lib/local-user"
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

describe("LocalYjsHost", () => {
  let dir: string

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "yjs-host-"))
    // The persistence singleton fixes its dir on first construction, so set
    // this before any host use.
    process.env.YJS_PERSISTENCE_DIR = dir
  })

  afterAll(async () => {
    // Background debounced flushes can recreate files in `dir`; retry removal
    // so teardown doesn't race them.
    await rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  })

  it("issues a token bound to the single local user", async () => {
    const { status, body } = await getLocalYjsHost().issueToken()
    expect(status).toBe(200)
    expect(JSON.parse(body).user.id).toBe(LOCAL_USER_ID)
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
      server = await startLocalYjsServer({ port: 0 })
    })

    afterAll(async () => {
      await server.close()
      // Let any disconnect-triggered + debounced (200ms) persistence flushes
      // settle before the outer afterAll removes the temp dir.
      await new Promise((r) => setTimeout(r, 350))
    })

    it("a connected peer and the server share one authoritative doc", async () => {
      const host = getLocalYjsHost()
      const clientDoc = new Y.Doc()
      const provider = new WebsocketProvider(
        `ws://localhost:${server.port}`,
        room,
        clientDoc,
        { WebSocketPolyfill: WebSocket as never, disableBc: true }
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
  })
})
