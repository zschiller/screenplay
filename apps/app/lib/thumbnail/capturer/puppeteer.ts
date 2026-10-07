import "server-only"

import {
  chromiumNetworkArgs,
  hasExtraCa,
  isLoopbackHost,
} from "@/lib/network/outbound-proxy"
import type {
  CaptureViewport,
  FramePageReader,
  ThumbnailCapturer,
} from "./types"

// Fallback viewport for a frame with no usable size (defensive — every real
// frame carries its own width/height).
const DEFAULT_VIEWPORT_W = 1280
const DEFAULT_VIEWPORT_H = 960
const NAV_TIMEOUT_MS = 15_000
/**
 * Settle after `load` before reading a page, as the Tauri shell does before its
 * snapshot: a client-rendered app often paints its content just after `load`.
 */
const READ_SETTLE_MS = 1_500

type Browser = import("puppeteer-core").Browser
type Page = import("puppeteer-core").Page

/**
 * The Chromium viewport for a frame: its **own** width and height, 1:1, with no
 * scaling. The live canvas renders each iframe layer at exactly these dimensions
 * (`iframe-layer.tsx`), so capturing at the same size makes the page lay out at
 * the same responsive breakpoint / fixed-width design it shows on the canvas —
 * anything narrower would reflow or clip the content, distorting the screenshot.
 * The downstream `sharp` resize shrinks the final blob to a thumbnail-sized webp,
 * so a large render only costs transient memory, not output size. Rounded to
 * whole pixels with a 1px floor so a degenerate dimension still yields a valid
 * viewport. (The Tauri-webview capturer already sizes its webview the same way.)
 */
function resolveViewport(viewport: CaptureViewport): {
  width: number
  height: number
} {
  const { width, height } = viewport
  if (!(width > 0) || !(height > 0)) {
    return { width: DEFAULT_VIEWPORT_W, height: DEFAULT_VIEWPORT_H }
  }
  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

/** The pixel density frames are screenshot at. */
const CAPTURE_SCALE = 2

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default

  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default
    return puppeteer.launch({
      args: chromium.args,
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }

  const executablePath =
    process.env.CHROMIUM_PATH ??
    (await (await import("puppeteer")).default.executablePath())

  return puppeteer.launch({
    headless: true,
    executablePath,
    // Behind a company proxy (#1929), off-box requests a preview makes (fonts,
    // images from a CDN) go through it, as the server's own do.
    args: chromiumNetworkArgs(process.env),
  })
}

/** Response headers that no longer describe the body once Node has read it. */
const STALE_RESPONSE_HEADERS = new Set([
  "content-encoding",
  "content-length",
  "transfer-encoding",
  "connection",
])

/**
 * A new page, ready to load a preview. With a company CA configured (#1929),
 * Chromium can't verify off-box hosts: it doesn't read `NODE_EXTRA_CA_CERTS`,
 * and adding a CA to it on Linux takes NSS tools the box may not have. So the
 * page hands every off-box request to the server's own `fetch`, which trusts
 * the CA and takes the proxy. Loopback (the preview itself) loads directly.
 */
async function newPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage()
  if (!hasExtraCa(process.env)) return page

  await page.setRequestInterception(true)
  page.on("request", (request) => {
    const url = new URL(request.url())
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      isLoopbackHost(url.hostname)
    ) {
      void request.continue()
      return
    }
    void fetch(url, {
      method: request.method(),
      headers: request.headers(),
      body: request.postData(),
      // Chromium follows a redirect itself, so it sees each hop.
      redirect: "manual",
    })
      .then(async (response) => {
        const headers: Record<string, string> = {}
        response.headers.forEach((value, name) => {
          if (!STALE_RESPONSE_HEADERS.has(name)) headers[name] = value
        })
        await request.respond({
          status: response.status,
          headers,
          body: Buffer.from(await response.arrayBuffer()),
        })
      })
      .catch(() => request.abort("failed").catch(() => {}))
  })
  return page
}

/**
 * The default Thumbnail Capturer: a headless Chromium that loads a frame's live
 * preview URL, sizes its viewport to the frame's own shape, waits for `load`,
 * and screenshots whatever has rendered, so an arbitrary preview still yields a
 * frame at the frame's aspect ratio.
 */
class PuppeteerCapturer implements ThumbnailCapturer, FramePageReader {
  async capture(
    previewUrl: string,
    viewport: CaptureViewport
  ): Promise<Buffer> {
    const browser = await launchBrowser()
    try {
      const page = await newPage(browser)
      // At 2x, like the Mac app's Retina snapshot, so a narrow frame still has
      // the pixels for a sharp hover-card preview (`frameCaptureSize`).
      await page.setViewport({
        ...resolveViewport(viewport),
        deviceScaleFactor: CAPTURE_SCALE,
      })
      await page.goto(previewUrl, {
        waitUntil: "load",
        timeout: NAV_TIMEOUT_MS,
      })

      const screenshot = await page.screenshot({ type: "png" })
      return Buffer.from(screenshot)
    } finally {
      await browser.close().catch(() => {})
    }
  }

  async evaluate(
    previewUrl: string,
    viewport: CaptureViewport,
    script: string
  ): Promise<string> {
    const browser = await launchBrowser()
    try {
      const page = await newPage(browser)
      await page.setViewport(resolveViewport(viewport))
      await page.goto(previewUrl, {
        waitUntil: "load",
        timeout: NAV_TIMEOUT_MS,
      })
      await new Promise((resolve) => setTimeout(resolve, READ_SETTLE_MS))
      const result: unknown = await page.evaluate(
        `(async () => {\n${script}\n})()`
      )
      return String(result)
    } finally {
      await browser.close().catch(() => {})
    }
  }
}

export function getPuppeteerCapturer(): ThumbnailCapturer & FramePageReader {
  return new PuppeteerCapturer()
}
