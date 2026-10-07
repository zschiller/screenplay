import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { chromium, type Browser, type Page } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { memoryFileStore } from "@/lib/files/store"
import { mockupFolderPrefix } from "@/lib/mockup-folder"
import { mockupPageBase } from "@/lib/mockup-folder-server"
import { mockupSrcDoc } from "@/lib/yjs/mockup-html"

// A Mockup page with files beside it in its folder (#1886), built by
// `mockupSrcDoc` with its folder's base and run in a real Chrome the way the
// canvas runs it: an `<iframe srcdoc>` sandboxed to `allow-scripts`, in an
// opaque origin, its files served by the real pages route. Skipped where no
// Chrome is installed; CI's browser job has one.

const store = vi.hoisted(() => ({ current: null as unknown }))
vi.mock("@/lib/files", () => ({
  get fileStore() {
    return store.current
  },
}))

function which(cmd: string): string | null {
  try {
    return (
      execFileSync("sh", ["-c", `command -v ${cmd}`])
        .toString()
        .trim() || null
    )
  } catch {
    return null
  }
}

const CHROME =
  process.env.CHROME ??
  which("google-chrome") ??
  which("chromium") ??
  (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : null)
if (process.env.SCREENPLAY_REQUIRE_BROWSER_STACK && !CHROME) {
  throw new Error("Chrome is required but wasn't found")
}

const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="9"></svg>'

describe.skipIf(!CHROME)("a Mockup page with its folder", () => {
  let browser: Browser
  let page: Page
  let server: http.Server
  let origin: string
  // Every path the stand-in app was asked for, and whether a cookie came.
  const requests: { path: string; cookie: boolean }[] = []

  beforeAll(async () => {
    process.env.TERMINAL_AUTH_SECRET ??= "test-secret"
    const files = memoryFileStore()
    store.current = files
    const put = (fileId: string, path: string, body: string) =>
      files.put(
        mockupFolderPrefix("room-1", fileId) + path,
        new TextEncoder().encode(body),
        ""
      )
    await put("m", "data.js", "window.DATA = { shot: 'captures/a.svg' }")
    await put("m", "style.css", "body { color: rgb(1, 2, 3) }")
    await put("m", "captures/a.svg", SVG)
    await put("m", "data.json", '{"n":4}')
    await put("other", "secret.json", '{"n":5}')

    const { GET } =
      await import("@/app/api/mockup-pages/[token]/[...path]/route")
    server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? "/", "http://x")
      if (url.pathname !== "/favicon.ico") {
        requests.push({ path: url.pathname, cookie: !!req.headers.cookie })
      }
      const match = /^\/api\/mockup-pages\/([^/]+)\/(.+)$/.exec(url.pathname)
      if (!match) {
        res.setHeader("Content-Type", "text/html")
        res.setHeader("Set-Cookie", "session=1; SameSite=Lax; Path=/")
        res.end("<!doctype html><body></body>")
        return
      }
      const out = await GET(new Request(`${origin}${url.pathname}`), {
        params: Promise.resolve({
          token: match[1]!,
          path: match[2]!.split("/").map(decodeURIComponent),
        }),
      })
      res.statusCode = out.status
      out.headers.forEach((value, name) => res.setHeader(name, value))
      res.end(Buffer.from(await out.arrayBuffer()))
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    browser = await chromium.launch({ executablePath: CHROME! })
    page = await browser.newPage()
    await page.goto(`${origin}/`)
  })

  afterAll(async () => {
    await browser?.close()
    server?.close()
  })

  const baseFor = (fileId: string, revision = 1) =>
    origin + mockupPageBase("room-1", fileId, revision).path

  /** Run `html` as Mockup `m` and read back what its page reports. */
  async function run(html: string) {
    const doc = mockupSrcDoc(html, "", {}, baseFor("m"))
    return page.evaluate(
      (srcdoc) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const frame = document.createElement("iframe")
          frame.setAttribute("sandbox", "allow-scripts")
          const onMessage = (e: MessageEvent) => {
            if (e.source !== frame.contentWindow || !e.data?.report) return
            window.removeEventListener("message", onMessage)
            frame.remove()
            resolve(e.data as Record<string, unknown>)
          }
          window.addEventListener("message", onMessage)
          setTimeout(() => reject(new Error("The page didn't report")), 5000)
          frame.srcdoc = srcdoc
          document.body.append(frame)
        }),
      doc
    )
  }

  it("loads its folder’s files by relative path, from its markup and its scripts", async () => {
    requests.length = 0
    const report = await run(`<!doctype html><html><head>
      <link rel="stylesheet" href="style.css">
      <script src="data.js"></script>
    </head><body><script>
      const img = new Image()
      img.src = window.DATA.shot
      img.onload = async () => {
        const json = await fetch("data.json").then((r) => r.json())
        parent.postMessage({
          report: true,
          color: getComputedStyle(document.body).color,
          width: img.naturalWidth,
          json,
        }, "*")
      }
    </script></body></html>`)

    expect(report).toEqual({
      report: true,
      color: "rgb(1, 2, 3)",
      width: 7,
      json: { n: 4 },
    })
    // The sandboxed page sends no cookie: the token in the path is the check.
    expect(requests.every((r) => !r.cookie)).toBe(true)
  })

  it("loads nothing outside its own folder", async () => {
    requests.length = 0
    const other = baseFor("other")
    const report = await run(`<script>
      Promise.all([
        fetch(${JSON.stringify(other + "secret.json")}).then(() => "loaded", () => "blocked"),
        fetch(${JSON.stringify(origin + "/")}).then(() => "loaded", () => "blocked"),
      ]).then((results) => parent.postMessage({ report: true, results }, "*"))
    </script>`)

    expect(report.results).toEqual(["blocked", "blocked"])
    expect(requests).toEqual([])
  })
})
