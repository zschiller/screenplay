import http from "node:http"
import type { AddressInfo } from "node:net"

import { afterEach, describe, expect, it } from "vitest"
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

  it("refuses every socket upgrade", async () => {
    const { base } = await viewerListener(identified)
    const ws = base.replace("http", "ws")
    for (const path of ["/_ws/yjs/room-1", "/_ws/terminal/ws"]) {
      await expect(
        new Promise((resolve, reject) => {
          const socket = new WebSocket(`${ws}${path}`)
          socket.on("open", () => resolve("open"))
          socket.on("error", reject)
          socket.on("unexpected-response", (_req, res) =>
            reject(new Error(`status ${res.statusCode}`))
          )
        })
      ).rejects.toThrow("status 404")
    }
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
