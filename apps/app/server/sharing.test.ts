import { mkdtempSync, readFileSync, writeFileSync } from "node:fs"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import type { PreviewExposure } from "@/lib/preview-exposure/types"

import { closable, listenOn } from "./front-server.mjs"
import { createSharing, type ViewerListener } from "./sharing.mjs"

/** A preview exposure that records what it was asked, like `tailscale serve`. */
function fakeExposure(fail?: string) {
  const served = new Set<number>()
  const calls: string[] = []
  const exposure: PreviewExposure = {
    async expose(port) {
      calls.push(`expose ${port}`)
      if (fail) throw new Error(fail)
      served.add(port)
      return { browserOrigin: `https://mac.tailnet.ts.net:${port}` }
    },
    async release(port) {
      calls.push(`release ${port}`)
      served.delete(port)
    },
  }
  return { exposure, served, calls }
}

const opened: Array<{ close: () => Promise<void> }> = []

afterEach(async () => {
  await Promise.all(opened.splice(0).map((o) => o.close()))
})

/** A viewer listener that answers every request, and the sockets it took. */
async function openListener(listener: ViewerListener) {
  const server = http.createServer((_req, res) => res.end("viewer"))
  const handle = closable(await listenOn(server, listener))
  opened.push(handle)
  return handle
}

function tempFile() {
  return path.join(mkdtempSync(path.join(os.tmpdir(), "sharing-")), "s.json")
}

/** Whether something accepts connections on 127.0.0.1:`port`. */
function listening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect(port, "127.0.0.1")
    socket.once("connect", () => {
      socket.destroy()
      resolve(true)
    })
    socket.once("error", () => resolve(false))
  })
}

async function freePort(): Promise<number> {
  const server = net.createServer()
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()))
  const { port } = server.address() as net.AddressInfo
  await new Promise<void>((r) => server.close(() => r()))
  return port
}

describe("Sharing", () => {
  it("is off until turned on, with nothing listening or exposed", async () => {
    const { exposure, calls } = fakeExposure()
    const sharing = createSharing({
      open: openListener,
      exposure: () => exposure,
    })
    expect(await sharing.start()).toEqual({
      on: false,
      origin: null,
      error: null,
    })
    expect(calls).toEqual([])
    await expect(sharing.expose(5123)).rejects.toThrow("Sharing is off.")
  })

  it("opens the viewer listener on loopback and serves it over the exposure", async () => {
    const { exposure, served } = fakeExposure()
    const port = await freePort()
    const sharing = createSharing({
      open: openListener,
      exposure: () => exposure,
      freePort: async () => port,
    })
    const state = await sharing.set(true)
    expect(state).toEqual({
      on: true,
      origin: `https://mac.tailnet.ts.net:${port}`,
      error: null,
    })
    expect(await listening(port)).toBe(true)
    expect([...served]).toEqual([port])
  })

  it("turning off closes the viewer listener and releases every exposure", async () => {
    const { exposure, served } = fakeExposure()
    const port = await freePort()
    const sharing = createSharing({
      open: openListener,
      exposure: () => exposure,
      freePort: async () => port,
    })
    await sharing.set(true)
    await sharing.expose(5123)
    await sharing.expose(5125)
    expect([...served].sort()).toEqual([port, 5123, 5125].sort())

    // A viewer's open connection (their canvas socket among them) ends too.
    const viewer = net.connect(port, "127.0.0.1")
    await new Promise((r) => viewer.once("connect", r))
    const ended = new Promise((r) => viewer.once("close", r))

    expect(await sharing.set(false)).toEqual({
      on: false,
      origin: null,
      error: null,
    })
    await ended
    expect(await listening(port)).toBe(false)
    expect([...served]).toEqual([])
    await expect(sharing.expose(5123)).rejects.toThrow("Sharing is off.")
  })

  it("tells open canvas sockets why before the listener closes", async () => {
    const { exposure } = fakeExposure()
    const order: string[] = []
    const sharing = createSharing({
      open: async (listener) => {
        const handle = await openListener(listener)
        return {
          close: async () => {
            order.push("listener closed")
            await handle.close()
          },
        }
      },
      exposure: () => exposure,
      closeViewerSockets: async () => {
        order.push("sockets told")
      },
      freePort,
    })
    await sharing.set(true)
    await sharing.set(false)
    expect(order).toEqual(["sockets told", "listener closed"])
  })

  it("stays off and says why when the exposure can’t serve the listener", async () => {
    const { exposure } = fakeExposure("Tailscale is turned off.")
    const port = await freePort()
    const sharing = createSharing({
      open: openListener,
      exposure: () => exposure,
      freePort: async () => port,
    })
    expect(await sharing.set(true)).toEqual({
      on: false,
      origin: null,
      error: "Tailscale is turned off.",
    })
    expect(await listening(port)).toBe(false)
  })

  it("releases a deleted chat’s preview only when Sharing exposed it", async () => {
    const { exposure, calls } = fakeExposure()
    const sharing = createSharing({
      open: openListener,
      exposure: () => exposure,
      freePort,
    })
    await sharing.set(true)
    await sharing.expose(5123)
    await sharing.release(5123)
    await sharing.release(6000)
    expect(calls.filter((c) => c.startsWith("release"))).toEqual([
      "release 5123",
    ])
  })

  describe("across launches", () => {
    it("keeps its port and turns back on if it was on", async () => {
      const file = tempFile()
      const port = await freePort()
      const first = fakeExposure()
      const before = createSharing({
        open: openListener,
        exposure: () => first.exposure,
        file,
        freePort: async () => port,
      })
      await before.set(true)
      await Promise.all(opened.splice(0).map((o) => o.close()))

      const next = fakeExposure()
      const after = createSharing({
        open: openListener,
        exposure: () => next.exposure,
        file,
        freePort: async () => {
          throw new Error("the saved port is used")
        },
      })
      const state = await after.start()
      expect(state.origin).toBe(`https://mac.tailnet.ts.net:${port}`)
      expect(await listening(port)).toBe(true)
    })

    it("releases what an earlier run left exposed when it was turned off", async () => {
      const file = tempFile()
      writeFileSync(
        file,
        JSON.stringify({ on: false, port: 7000, exposed: [5123] })
      )
      const { exposure, calls } = fakeExposure()
      const sharing = createSharing({
        open: openListener,
        exposure: () => exposure,
        file,
      })
      await sharing.start()
      expect(calls.sort()).toEqual(["release 5123", "release 7000"])
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({
        on: false,
        port: 7000,
        exposed: [],
      })
    })
  })
})
