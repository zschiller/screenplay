import { execFileSync } from "node:child_process"
import { existsSync } from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import { chromium, type Browser, type Page } from "playwright-core"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import type { MockupResources } from "@/lib/mockup-refs"
import { mockupSrcDoc } from "./mockup-html"

// A Mockup page with `skill:` and `files:` references (#1643), built by
// `mockupSrcDoc` and run in a real Chrome the way the canvas runs it: an
// `<iframe srcdoc>` sandboxed to `allow-scripts`, in an opaque origin.
// Skipped where no Chrome is installed; CI's browser job has one.

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

const b64 = (s: string) => Buffer.from(s).toString("base64")

const RESOURCES: MockupResources = {
  "skill:explore/runtime.js": {
    type: "text/javascript",
    data: b64("window.order = (window.order || []).concat('runtime')"),
  },
  "skill:explore/runtime.css": {
    type: "text/css",
    data: b64("body { color: rgb(1, 2, 3) }"),
  },
  "files:shots/home.png": {
    type: "image/svg+xml",
    data: b64(
      '<svg xmlns="http://www.w3.org/2000/svg" width="7" height="9"></svg>'
    ),
  },
  "files:gone.png": null,
}

describe.skipIf(!CHROME)("a Mockup page with references", () => {
  let browser: Browser
  let page: Page
  let server: http.Server
  // Every path the stand-in app's server was asked for.
  const requests: string[] = []

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      requests.push(req.url ?? "")
      res.setHeader("Content-Type", "text/html")
      res.end("<!doctype html><body></body>")
    })
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r))
    browser = await chromium.launch({ executablePath: CHROME! })
    page = await browser.newPage()
    const { port } = server.address() as AddressInfo
    await page.goto(`http://127.0.0.1:${port}/`)
  })

  afterAll(async () => {
    await browser?.close()
    server?.close()
  })

  /** Run `html` as a Mockup and read back what its page reports. */
  async function run(html: string, resources: MockupResources) {
    const doc = mockupSrcDoc(html, "", resources)
    return page.evaluate(
      (srcdoc) =>
        new Promise<Record<string, unknown>>((resolve, reject) => {
          const frame = document.createElement("iframe")
          frame.setAttribute("sandbox", "allow-scripts")
          const onMessage = (e: MessageEvent) => {
            if (e.source !== frame.contentWindow) return
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

  // Reports after load: the order its scripts ran in, the stylesheet's
  // colour, each image's size, and its root attributes.
  const REPORT = `<script>
    addEventListener("load", () => parent.postMessage({
      order: window.order,
      color: getComputedStyle(document.body).color,
      images: Array.from(document.images, (i) => i.naturalWidth),
      lang: document.documentElement.lang,
      bodyClass: document.body.className,
      srcs: Array.from(document.querySelectorAll("[src],[href]"), (e) => (e.getAttribute("src") || e.getAttribute("href")).split(":")[0]),
    }, "*"))
  </script>`

  it("resolves skill: and files: references inside the page's own origin", async () => {
    const report = await run(
      `<!doctype html><html lang="en"><head>
        <link rel="stylesheet" href="skill:explore/runtime.css">
        <script src="skill:explore/runtime.js"></script>
        <script>window.order = window.order.concat("page")</script>
        ${REPORT}
      </head><body class="pick">
        <img src="files:shots/home.png">
      </body></html>`,
      RESOURCES
    )
    expect(report).toEqual({
      order: ["runtime", "page"],
      color: "rgb(1, 2, 3)",
      images: [7],
      lang: "en",
      bodyClass: "pick",
      srcs: ["blob", "blob", "blob"],
    })
  })

  it("renders a reference that didn't resolve empty, and the rest still runs", async () => {
    const report = await run(
      `<script src="files:gone.png"></script>
       <script src="skill:explore/missing.js"></script>
       <script>window.order = ["page"]</script>
       ${REPORT}
       <img src="files:gone.png"><img src="files:shots/home.png">`,
      RESOURCES
    )
    expect(report.order).toEqual(["page"])
    expect(report.images).toEqual([0, 7])
  })

  it("still loads nothing from the network", async () => {
    const { port } = server.address() as AddressInfo
    requests.length = 0
    const report = await run(
      `<script src="http://127.0.0.1:${port}/x.js"></script>
       <link rel="stylesheet" href="http://127.0.0.1:${port}/x.css">
       <img src="http://127.0.0.1:${port}/x.png">
       <img src="files:shots/home.png">
       ${REPORT}`,
      RESOURCES
    )
    expect(report.images).toEqual([0, 7])
    expect(requests).toEqual([])
  })
})
