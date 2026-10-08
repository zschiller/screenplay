import http from "node:http"
import type { AddressInfo } from "node:net"

import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WebSocket } from "ws"

import type { ViewerAnswer, ViewerRequest } from "@/lib/viewer-identity/types"

import {
  createHostServer,
  createViewerServer,
  listenOn,
  listenOnHost,
} from "./front-server.mjs"
import {
  REFUSAL_HEADER,
  REFUSED_PATH,
  VIEWER_HEADER,
  decodeHeaderValue,
  encodeHeaderValue,
} from "./viewer.mjs"
import { shareKey } from "./share-link.mjs"
import { VIEWER_ALLOWLIST } from "./viewer-allowlist.mjs"

const servers: http.Server[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r())))
  )
})

const LISTENER = { name: "tailnet", address: "127.0.0.1", port: 0 }

/** What Next was handed: the URL and the two reserved headers, decoded. */
interface Seen {
  url: string
  method: string
  viewer: unknown
  refusal: unknown
}

/** A stand-in for Next that reports what it was handed. */
function fakeNext(seen: Seen[]): http.RequestListener {
  return (req, res) => {
    seen.push({
      url: req.url ?? "",
      method: req.method ?? "",
      viewer: decodeHeaderValue(req.headers[VIEWER_HEADER] as string),
      refusal: decodeHeaderValue(req.headers[REFUSAL_HEADER] as string),
    })
    res.end("next")
  }
}

const ANA = { id: "tailscale:ana@example.com", name: "Ana" }

async function viewerListener(
  identify: (request: ViewerRequest) => Promise<ViewerAnswer>,
  allowlist = VIEWER_ALLOWLIST
) {
  const seen: Seen[] = []
  const server = createViewerServer(fakeNext(seen), LISTENER, {
    identify,
    allowlist,
  })
  servers.push(server)
  await listenOn(server, LISTENER)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  return { base, seen }
}

const identified = async (): Promise<ViewerAnswer> => ({
  person: ANA,
  ttlSeconds: 60,
})

const WRITES = ["POST", "PUT", "PATCH", "DELETE"]

describe("a viewer listener", () => {
  it("binds the address the config gives", async () => {
    const server = createViewerServer(fakeNext([]), LISTENER, {
      identify: identified,
    })
    servers.push(server)
    await listenOn(server, LISTENER)
    expect((server.address() as AddressInfo).address).toBe("127.0.0.1")
  })

  describe.each(VIEWER_ALLOWLIST.map((entry) => [entry.name, entry] as const))(
    "allowlist entry %s",
    (_name, entry) => {
      it("serves its reads", async () => {
        const { base, seen } = await viewerListener(identified)
        const res = await fetch(`${base}${entry.example}`)
        expect(res.status).toBe(200)
        expect(seen.map((s) => s.url)).toEqual([entry.example])
      })

      it.each(WRITES.filter((m) => !entry.methods.includes(m)))(
        "refuses %s before Next sees it",
        async (method) => {
          const { base, seen } = await viewerListener(identified)
          const res = await fetch(`${base}${entry.example}`, { method })
          expect(res.status).toBe(403)
          expect(seen).toEqual([])
        }
      )
    }
  )

  it.each(WRITES)(
    "refuses %s anywhere else, a server action included",
    async (method) => {
      const { base, seen } = await viewerListener(identified)
      for (const path of ["/", "/room-1", "/api/agent/run", "/settings"]) {
        const res = await fetch(`${base}${path}`, {
          method,
          headers: { "Next-Action": "abc123" },
        })
        expect(res.status).toBe(403)
      }
      expect(seen).toEqual([])
    }
  )

  // What a viewer's page would send if its hidden controls were still there
  // (#1933): each refused before Next sees it.
  it.each([
    ["sending a message", "POST", "/api/agent/stream"],
    ["stopping a run", "POST", "/api/agent/stop"],
    ["approving a plan", "POST", "/api/agent/plan"],
    ["opening a chat's code", "POST", "/api/branch/create"],
    ["opening a terminal", "POST", "/api/terminal/url"],
    ["a server action from the canvas link", "POST", "/s/room-1/key"],
    ["a server action under the link", "POST", "/s/room-1/key/history"],
  ])("refuses %s", async (_what, method, path) => {
    const { base, seen } = await viewerListener(identified)
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "Next-Action": "abc123" },
    })
    expect(res.status).toBe(403)
    expect(seen).toEqual([])
  })

  it("takes comments as the only write", async () => {
    // Every entry but comments serves reads alone (#1934).
    const writes = VIEWER_ALLOWLIST.flatMap((entry) =>
      entry.methods
        .filter((m) => m !== "GET" && m !== "HEAD")
        .map((m) => `${m} ${entry.name}`)
    )
    expect(writes).toEqual(["POST comments"])

    const { base, seen } = await viewerListener(identified)
    const res = await fetch(`${base}/s/room-1/key/comments`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ op: "reply", threadId: "t1", body: "Hi" }),
    })
    expect(res.status).toBe(200)
    expect(seen).toEqual([
      {
        url: "/s/room-1/key/comments",
        method: "POST",
        viewer: ANA,
        refusal: null,
      },
    ])
  })

  it("refuses a server action posted to the comments path", async () => {
    const { base, seen } = await viewerListener(identified)
    const res = await fetch(`${base}/s/room-1/key/comments`, {
      method: "POST",
      headers: { "Next-Action": "abc123" },
    })
    expect(res.status).toBe(403)
    expect(seen).toEqual([])
  })

  it("serves no terminal data", async () => {
    const { base, seen } = await viewerListener(identified)
    for (const path of [
      "/api/terminal/host",
      "/api/terminal/url",
      "/api/terminal/auth",
      "/s/room-1/key/terminal",
    ]) {
      expect((await fetch(`${base}${path}`)).status, path).toBe(404)
    }
    expect(seen).toEqual([])
  })

  it("answers 404 to an identified viewer's read off the allowlist", async () => {
    const { base, seen } = await viewerListener(identified)
    for (const path of ["/", "/files", "/settings", "/api/health"]) {
      expect((await fetch(`${base}${path}`)).status).toBe(404)
    }
    expect(seen).toEqual([])
  })

  it("hands Next the viewer an allowed read is from", async () => {
    const asks: ViewerRequest[] = []
    const { base, seen } = await viewerListener(
      async (request) => {
        asks.push(request)
        return identified()
      },
      [
        {
          name: "a viewer read",
          methods: ["GET", "HEAD"],
          identify: true,
          match: (p) => p === "/watch",
          example: "/watch",
        },
      ]
    )
    await fetch(`${base}/watch`, {
      headers: { "Tailscale-User-Login": "ana@x" },
    })
    expect(seen).toEqual([
      { url: "/watch", method: "GET", viewer: ANA, refusal: null },
    ])
    expect(asks[0]?.headers.get("tailscale-user-login")).toBe("ana@x")
    expect(asks[0]?.remoteAddress).toMatch(/127\.0\.0\.1/)
    expect(asks[0]?.listener).toEqual(LISTENER)
  })

  it("serves a refused viewer the refused page, whatever they asked for", async () => {
    const { base, seen } = await viewerListener(async () => ({
      person: null,
      message: "Open this link on a device on the same tailnet.",
      ttlSeconds: 0,
    }))
    await fetch(`${base}/room-1?link=abc`)
    await fetch(`${base}/`)
    expect(seen).toEqual(
      [1, 2].map(() => ({
        url: REFUSED_PATH,
        method: "GET",
        viewer: null,
        refusal: { message: "Open this link on a device on the same tailnet." },
      }))
    )
  })

  it("strips a client's copy of the identity headers", async () => {
    const { base, seen } = await viewerListener(
      async () => ({ person: null, message: "No.", ttlSeconds: 0 }),
      [
        {
          name: "public",
          methods: ["GET"],
          identify: false,
          match: (p) => p === "/public",
          example: "/public",
        },
      ]
    )
    const spoofed = {
      [VIEWER_HEADER]: encodeHeaderValue({ id: "x:boss", name: "Boss" }),
      [REFUSAL_HEADER]: encodeHeaderValue({ message: "spoofed" }),
    }
    await fetch(`${base}/public`, { headers: spoofed })
    await fetch(`${base}/elsewhere`, { headers: spoofed })
    expect(seen).toEqual([
      { url: "/public", method: "GET", viewer: null, refusal: null },
      {
        url: REFUSED_PATH,
        method: "GET",
        viewer: null,
        refusal: { message: "No." },
      },
    ])
  })

  describe("socket upgrades", () => {
    const SECRET = "a".repeat(64)
    let previous: string | undefined
    beforeEach(() => {
      previous = process.env.ENCRYPTION_KEY
      process.env.ENCRYPTION_KEY = SECRET
    })
    afterEach(() => {
      if (previous === undefined) delete process.env.ENCRYPTION_KEY
      else process.env.ENCRYPTION_KEY = previous
    })

    /** Open `path` on a viewer listener; resolve "open" or the refusal's status. */
    async function upgrade(
      identify: (request: ViewerRequest) => Promise<ViewerAnswer>,
      path: string
    ) {
      const accepted: Array<{ roomId: string; person: unknown }> = []
      const server = createViewerServer(fakeNext([]), LISTENER, {
        identify,
        acceptYjs: () => (req, socket, head, viewer) => {
          accepted.push(viewer)
          socket.end(
            "HTTP/1.1 418 Accepted\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
          )
        },
      })
      servers.push(server)
      await listenOn(server, LISTENER)
      const ws = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`
      const outcome = await new Promise<string>((resolve) => {
        const socket = new WebSocket(`${ws}${path}`)
        socket.on("open", () => resolve("open"))
        socket.on("error", () => {})
        socket.on("unexpected-response", (_req, res) =>
          resolve(`status ${res.statusCode}`)
        )
      })
      return { outcome, accepted }
    }

    it("refuses terminals, other sockets and a canvas socket without its key", async () => {
      const key = shareKey("room-1")
      for (const path of [
        "/_ws/terminal/ws",
        `/_ws/terminal/ws?key=${key}`,
        "/_ws/yjs/room-1",
        "/_ws/yjs/room-1?key=wrong",
        `/_ws/yjs/room-2?key=${key}`,
        `/_ws/yjs/room-1/x?key=${key}`,
        `/elsewhere?key=${key}`,
      ]) {
        const { outcome, accepted } = await upgrade(identified, path)
        expect(outcome, path).toBe("status 404")
        expect(accepted).toEqual([])
      }
    })

    it("refuses a canvas socket from someone the identity refuses", async () => {
      const { outcome, accepted } = await upgrade(
        async () => ({ person: null, message: "No.", ttlSeconds: 0 }),
        `/_ws/yjs/room-1?key=${shareKey("room-1")}`
      )
      expect(outcome).toBe("status 403")
      expect(accepted).toEqual([])
    })

    it("hands the Yjs server a canvas socket with its key, and who it's from", async () => {
      const { outcome, accepted } = await upgrade(
        identified,
        `/_ws/yjs/room-1?key=${shareKey("room-1")}`
      )
      expect(outcome).toBe("status 418")
      expect(accepted).toEqual([{ roomId: "room-1", person: ANA }])
    })
  })
})

describe("the host listener", () => {
  it("never identifies anyone, and strips a client's copy of the identity headers", async () => {
    const seen: Seen[] = []
    const server = createHostServer(fakeNext(seen), () => undefined)
    servers.push(server)
    await listenOnHost(server, 0)
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    await fetch(`${base}/room-1`, {
      method: "POST",
      headers: {
        [VIEWER_HEADER]: encodeHeaderValue(ANA),
        [REFUSAL_HEADER]: encodeHeaderValue({ message: "spoofed" }),
      },
    })
    expect(seen).toEqual([
      { url: "/room-1", method: "POST", viewer: null, refusal: null },
    ])
  })
})
