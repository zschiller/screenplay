import "server-only"

import type { CaptureViewport, ThumbnailCapturer } from "./types"

// Fallback viewport for a frame with no usable size (defensive — every real
// frame carries its own width/height).
const DEFAULT_VIEWPORT_W = 1280
const DEFAULT_VIEWPORT_H = 960
// Cap on the longer side of the capture viewport. A frame's shape is preserved
// (both sides scale by the same factor), so the screenshot keeps the frame's
// aspect ratio — this just stops an unusually large or fit-to-content frame
// from rendering a giant page that the downstream resize would only shrink.
const MAX_VIEWPORT_DIM = 1280
const NAV_TIMEOUT_MS = 15_000

type Browser = import("puppeteer-core").Browser

/**
 * The Chromium viewport for a frame: its own size, scaled down (never up) so the
 * longer side is at most {@link MAX_VIEWPORT_DIM}, preserving the frame's aspect
 * ratio. Rounded to whole pixels with a 1px floor so a degenerate dimension
 * still yields a valid viewport.
 */
function resolveViewport(viewport: CaptureViewport): {
  width: number
  height: number
} {
  const { width, height } = viewport
  if (!(width > 0) || !(height > 0)) {
    return { width: DEFAULT_VIEWPORT_W, height: DEFAULT_VIEWPORT_H }
  }
  const scale = Math.min(1, MAX_VIEWPORT_DIM / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

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
    (await import("puppeteer")).default.executablePath()

  return puppeteer.launch({
    headless: true,
    executablePath,
  })
}

/**
 * The default Thumbnail Capturer: a headless Chromium that loads a frame's live
 * preview URL, sizes its viewport to the frame's own shape, waits for `load`,
 * and screenshots whatever has rendered, so an arbitrary preview still yields a
 * frame at the frame's aspect ratio.
 */
class PuppeteerCapturer implements ThumbnailCapturer {
  async capture(previewUrl: string, viewport: CaptureViewport): Promise<Buffer> {
    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.setViewport(resolveViewport(viewport))
      await page.goto(previewUrl, { waitUntil: "load", timeout: NAV_TIMEOUT_MS })

      const screenshot = await page.screenshot({ type: "png" })
      return Buffer.from(screenshot)
    } finally {
      await browser.close().catch(() => {})
    }
  }
}

export function getPuppeteerCapturer(): ThumbnailCapturer {
  return new PuppeteerCapturer()
}
