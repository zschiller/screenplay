import http from "node:http"
import type { AddressInfo } from "node:net"
import net from "node:net"
import os from "node:os"

import { afterEach, describe, expect, it } from "vitest"
import { WebSocket, WebSocketServer } from "ws"

import { createHostServer, listenOnHost } from "./front-server.mjs"

const servers: { close(cb?: () => void): unknown }[] = []

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r())))
  )
})

function portOf(server: http.Server): number {
  return (server.address() as AddressInfo).port
}

/** A stand-in socket server that reports the path and Origin it was opened with. */
async function socketServer(): Promise<number> {
  const http1 = http.createServer()
  const wss = new WebSocketServer({ server: http1 })
  wss.on("connection", (ws, req) => {
    ws.send(JSON.stringify({ url: req.url, origin: req.headers.origin }))
  })
  servers.push(wss, http1)
  await new Promise<void>((r) => http1.listen(0, "127.0.0.1", () => r()))
  return portOf(http1)
}

async function hostListener(
  ports: Partial<Record<"yjs" | "terminal", number>>
) {
  const server = createHostServer(
    (_req, res) => res.end("next"),
    (name) => ports[name]
  )
  servers.push(server)
  return listenOnHost(server, 0)
}

function firstMessage(url: string, origin: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url, { origin })
    ws.on("message", (data) => {
      resolve(JSON.parse(String(data)))
      ws.close()
    })
    ws.on("error", reject)
    ws.on("unexpected-response", (_req, res) =>
      reject(new Error(`status ${res.statusCode}`))
    )
  })
}

describe("the host listener", () => {
  it("listens on 127.0.0.1 only", async () => {
    const server = await hostListener({})
    expect((server.address() as AddressInfo).address).toBe("127.0.0.1")

    // Any address of this machine other than loopback is refused.
    const external = Object.values(os.networkInterfaces())
      .flat()
      .find((a) => a && a.family === "IPv4" && !a.internal)
    if (external) {
      await expect(
        new Promise((resolve, reject) => {
          const socket = net.connect(portOf(server), external.address)
          socket.on("connect", () => {
            socket.destroy()
            resolve("connected")
          })
          socket.on("error", reject)
        })
      ).rejects.toThrow(/ECONNREFUSED/)
    }
  })

  it("hands plain requests to Next", async () => {
    const server = await hostListener({})
    const res = await fetch(`http://127.0.0.1:${portOf(server)}/`)
    expect(await res.text()).toBe("next")
  })

  it("pipes each socket route to its server, without the route's prefix", async () => {
    const yjs = await socketServer()
    const terminal = await socketServer()
    const server = await hostListener({ yjs, terminal })
    const base = `ws://127.0.0.1:${portOf(server)}`
    const origin = `http://localhost:${portOf(server)}`

    expect(
      await firstMessage(`${base}/_ws/yjs/room-1?token=t`, origin)
    ).toEqual({ url: "/room-1?token=t", origin })
    expect(
      await firstMessage(`${base}/_ws/terminal/ws?sandbox=a&token=t`, origin)
    ).toEqual({ url: "/ws?sandbox=a&token=t", origin })
  })

  it("refuses any other upgrade, and a route whose server isn't up yet", async () => {
    const server = await hostListener({})
    const base = `ws://127.0.0.1:${portOf(server)}`
    await expect(firstMessage(`${base}/elsewhere`, "x")).rejects.toThrow(
      "status 404"
    )
    await expect(firstMessage(`${base}/_ws/yjs/room-1`, "x")).rejects.toThrow(
      "status 404"
    )
  })
})
