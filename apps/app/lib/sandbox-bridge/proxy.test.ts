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
  let upstream: http.Server | undefined
  let proxy: ChildProcess
  let listenPort: number

  afterEach(async () => {
    proxy?.kill("SIGKILL")
    const server = upstream
    upstream = undefined
    if (server)
      await new Promise<void>((resolve) => server.close(() => resolve()))
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
      upstream!.listen(upstreamPort, "127.0.0.1", resolve)
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

  /** Start the proxy with `env` and resolve with the address it logs. */
  async function boundAddress(
    env: Record<string, string>,
    base: NodeJS.ProcessEnv = process.env
  ): Promise<string> {
    listenPort = await freePort()
    proxy = spawn(process.execPath, [PROXY_PATH], {
      env: {
        ...base,
        SCREENPLAY_LISTEN_PORT: String(listenPort),
        ...env,
      },
      stdio: ["ignore", "pipe", "ignore"],
    })
    let out = ""
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no listen log")), 5000)
      proxy.stdout!.on("data", (chunk: Buffer) => {
        out += chunk.toString()
        const match = /listening on (\S+) ->/.exec(out)
        if (match) {
          clearTimeout(timer)
          resolve(match[1]!)
        }
      })
    })
  }

  it("binds loopback by default, keeping previews off the LAN", async () => {
    const env = { ...process.env }
    delete env.SCREENPLAY_LISTEN_HOST
    expect(await boundAddress({}, env)).toBe(`127.0.0.1:${listenPort}`)
  })

  it("binds every interface when a hosted sandbox asks", async () => {
    expect(await boundAddress({ SCREENPLAY_LISTEN_HOST: "0.0.0.0" })).toBe(
      `0.0.0.0:${listenPort}`
    )
  })

  describe("seeding a local copy of a shared frame (#1397)", () => {
    const COOKIES = [
      {
        name: "session",
        value: "s3cret",
        path: "/",
        expires: -1,
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
      {
        name: "theme",
        value: "dark",
        path: "/app",
        expires: 4102444800,
        httpOnly: false,
        secure: false,
      },
      // Never a header injection.
      { name: "bad", value: "x\r\nSet-Cookie: evil=1", path: "/" },
    ]

    async function seed(
      headers: Record<string, string>,
      body: object = { cookies: COOKIES, secure: false }
    ) {
      await boundAddress({ SCREENPLAY_LISTEN_HOST: "127.0.0.1" })
      return fetch(`http://127.0.0.1:${listenPort}/__screenplay-seed`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      })
    }

    it("serves the seed page without the bridge", async () => {
      await boundAddress({ SCREENPLAY_LISTEN_HOST: "127.0.0.1" })
      const res = await fetch(
        `http://127.0.0.1:${listenPort}/__screenplay-seed`
      )
      const body = await res.text()
      expect(res.status).toBe(200)
      expect(body).toContain("screenplay:seed-ready")
      expect(body).not.toContain("__screenplay-bridge.js")
    })

    it("sets the shared page's cookies and expires the ones it didn't have", async () => {
      const res = await seed({
        "x-screenplay-seed": "1",
        "sec-fetch-site": "same-origin",
        cookie: "stale=1; session=old",
      })
      expect(res.status).toBe(204)
      expect(res.headers.getSetCookie()).toEqual([
        "stale=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "session=s3cret; Path=/; HttpOnly; SameSite=Lax",
        "theme=dark; Path=/app; Expires=Fri, 01 Jan 2100 00:00:00 GMT",
      ])
    })

    it("makes them third-party cookies in a secure context, where the frame is a third party", async () => {
      const res = await seed(
        { "x-screenplay-seed": "1", cookie: "stale=1" },
        { cookies: COOKIES, secure: true }
      )
      expect(res.headers.getSetCookie()).toEqual([
        "stale=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Secure; SameSite=None; Partitioned",
        "stale=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
        "session=s3cret; Path=/; HttpOnly; Secure; SameSite=None; Partitioned",
        "theme=dark; Path=/app; Expires=Fri, 01 Jan 2100 00:00:00 GMT; Secure; SameSite=None; Partitioned",
      ])
    })

    it("refuses anything but the seed page's own request", async () => {
      expect((await seed({})).status).toBe(403)
      proxy.kill("SIGKILL")
      expect(
        (
          await seed({
            "x-screenplay-seed": "1",
            "sec-fetch-site": "cross-site",
          })
        ).status
      ).toBe(403)
    })
  })
})
