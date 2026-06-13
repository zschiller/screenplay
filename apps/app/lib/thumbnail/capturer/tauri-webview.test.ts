import { createServer, type Server } from "node:http"
import { AddressInfo } from "node:net"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { getTauriWebviewCapturer, TAURI_CONTROL_URL_ENV_VAR } from "./tauri-webview"

const original = process.env[TAURI_CONTROL_URL_ENV_VAR]

afterEach(() => {
  if (original === undefined) delete process.env[TAURI_CONTROL_URL_ENV_VAR]
  else process.env[TAURI_CONTROL_URL_ENV_VAR] = original
})

describe("TauriWebviewCapturer", () => {
  it("throws when the control URL is not set (only runs inside the shell)", async () => {
    delete process.env[TAURI_CONTROL_URL_ENV_VAR]
    await expect(getTauriWebviewCapturer().capture("http://preview/")).rejects.toThrow(
      /TAURI_CONTROL_URL is not set/
    )
  })

  describe("against a stub control server", () => {
    let server: Server
    let received: { url?: string; body?: string; posts: number }

    beforeEach(async () => {
      received = { posts: 0 }
      server = createServer((req, res) => {
        received.url = req.url
        received.posts += 1
        let body = ""
        req.on("data", (c) => (body += c))
        req.on("end", () => {
          received.body = body
          res.writeHead(200, { "content-type": "image/png" })
          res.end(Buffer.from([0x89, 0x50, 0x4e, 0x47])) // PNG magic bytes
        })
      })
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
      const { port } = server.address() as AddressInfo
      process.env[TAURI_CONTROL_URL_ENV_VAR] = `http://127.0.0.1:${port}`
    })

    afterEach(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })

    it("POSTs the preview URL to /thumbnail and returns the PNG bytes", async () => {
      const buf = await getTauriWebviewCapturer().capture("http://preview-42.example.com/")

      expect(received.url).toBe("/thumbnail")
      expect(JSON.parse(received.body ?? "{}")).toEqual({
        renderUrl: "http://preview-42.example.com/",
      })
      expect([...buf]).toEqual([0x89, 0x50, 0x4e, 0x47])
    })

    it("screenshots a single localhost frame preview URL per call (per-frame parity)", async () => {
      // The per-frame input: the local backend's named `.localhost` route for
      // one frame's dev server, not a whole-canvas render page.
      const frameUrl = "http://feat-x.myapp.localhost:1355/settings"
      const buf = await getTauriWebviewCapturer().capture(frameUrl)

      // Exactly one screenshot request, carrying just this frame's URL.
      expect(received.posts).toBe(1)
      expect(received.url).toBe("/thumbnail")
      expect(JSON.parse(received.body ?? "{}")).toEqual({ renderUrl: frameUrl })
      // And raw PNG bytes come back as a Buffer for the shared resize/store path.
      expect(Buffer.isBuffer(buf)).toBe(true)
      expect([...buf]).toEqual([0x89, 0x50, 0x4e, 0x47])
    })
  })

  it("throws when the control server reports an error status", async () => {
    const server = createServer((_req, res) => {
      res.writeHead(500)
      res.end("boom")
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const { port } = server.address() as AddressInfo
    process.env[TAURI_CONTROL_URL_ENV_VAR] = `http://127.0.0.1:${port}`
    try {
      await expect(
        getTauriWebviewCapturer().capture("http://preview-42.example.com/")
      ).rejects.toThrow(/returned 500/)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
