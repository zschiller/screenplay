import { type ChildProcess, spawn } from "node:child_process"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { afterEach, describe, expect, it } from "vitest"

const PROXY_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "proxy.mjs"
)

/** Bind to port 0, read the OS-assigned port, then release it for a child. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = http.createServer()
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address()
      if (addr && typeof addr === "object") {
        const { port } = addr
        srv.close(() => resolve(port))
      } else {
        srv.close(() => reject(new Error("no port")))
      }
    })
    srv.on("error", reject)
  })
}

/** Wait until `fn` resolves truthy or the deadline passes. */
async function until(fn: () => Promise<boolean>, ms = 5000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (await fn().catch(() => false)) return
    await new Promise((r) => setTimeout(r, 50))
  }
  throw new Error("timed out waiting for condition")
}

describe("bridge proxy", () => {
  let upstream: http.Server
  let proxy: ChildProcess
  let listenPort: number

  afterEach(async () => {
    proxy?.kill("SIGKILL")
    await new Promise<void>((resolve) => upstream?.close(() => resolve()))
  })

  /**
   * The fix this guards: Next's dev server streams HTML with
   * `Transfer-Encoding: chunked` and no `Content-Length`. The proxy buffers the
   * body to inject the bridge and sets its own `Content-Length`, so it MUST drop
   * the upstream's `Transfer-Encoding` — otherwise the response carries both
   * framing headers at once. Lenient clients (curl, browsers) tolerate that, but
   * a strict HTTP parser rejects it (Node/undici: HPE_INVALID_CONTENT_LENGTH) —
   * which is exactly the parser the server-side preview probe (`fetch`) uses, so
   * the dev server never read as ready and the iframe stayed dark.
   */
  it("serves a strict-parser-valid response for chunked HTML upstreams", async () => {
    const upstreamPort = await freePort()
    listenPort = await freePort()

    upstream = http.createServer((_req, res) => {
      // Chunked, no content-length — exactly how Next's dev server frames HTML.
      res.writeHead(200, {
        "content-type": "text/html; charset=utf-8",
        "transfer-encoding": "chunked",
      })
      res.write("<html><head></head><body>hi</body></html>")
      res.end()
    })
    await new Promise<void>((resolve) =>
      upstream.listen(upstreamPort, "127.0.0.1", resolve)
    )

    proxy = spawn(process.execPath, [PROXY_PATH], {
      env: {
        ...process.env,
        SCREENPLAY_UPSTREAM_PORT: String(upstreamPort),
        SCREENPLAY_LISTEN_PORT: String(listenPort),
      },
      stdio: "ignore",
    })

    const url = `http://127.0.0.1:${listenPort}/`
    // A strict fetch through the proxy must succeed — it throws on the
    // double-framing bug the way the real probe did.
    await until(() => fetch(url).then((r) => r.ok))

    const res = await fetch(url)
    const body = await res.text()
    expect(res.status).toBe(200)
    expect(res.headers.get("transfer-encoding")).toBeNull()
    // The bridge tag was injected and the original markup survived.
    expect(body).toContain("__screenplay-bridge.js")
    expect(body).toContain("<body>hi</body>")
  })
})
