import "server-only"

import type { ThumbnailCapturer } from "./types"

const VIEWPORT_W = 1280
const VIEWPORT_H = 960
const NAV_TIMEOUT_MS = 15_000
const READY_TIMEOUT_MS = 9_000

type Browser = import("puppeteer-core").Browser

async function launchBrowser(): Promise<Browser> {
  const puppeteer = (await import("puppeteer-core")).default

  if (process.env.VERCEL) {
    const chromium = (await import("@sparticuz/chromium")).default
    return puppeteer.launch({
      args: chromium.args,
      defaultViewport: { width: VIEWPORT_W, height: VIEWPORT_H },
      executablePath: await chromium.executablePath(),
      headless: true,
    })
  }

  const executablePath =
    process.env.CHROMIUM_PATH ??
    (await import("puppeteer")).default.executablePath()

  return puppeteer.launch({
    headless: true,
    defaultViewport: { width: VIEWPORT_W, height: VIEWPORT_H },
    executablePath,
  })
}

/**
 * The default Thumbnail Capturer: a headless Chromium that loads a frame's live
 * preview URL and screenshots it. If the page signals `__thumbnailReady` it
 * shoots immediately; otherwise it falls through after a short wait and shoots
 * whatever has rendered, so an arbitrary preview still yields a frame.
 */
class PuppeteerCapturer implements ThumbnailCapturer {
  async capture(previewUrl: string): Promise<Buffer> {
    const browser = await launchBrowser()
    try {
      const page = await browser.newPage()
      await page.setViewport({ width: VIEWPORT_W, height: VIEWPORT_H })
      await page.goto(previewUrl, { waitUntil: "load", timeout: NAV_TIMEOUT_MS })

      await page
        .waitForFunction(() => (window as Window).__thumbnailReady === true, {
          timeout: READY_TIMEOUT_MS,
        })
        .catch(() => {
          // Fall through with whatever has rendered so far.
        })

      const element = await page.$("[data-thumbnail-root]")
      const target = element ?? page
      const screenshot = await target.screenshot({ type: "png" })
      return Buffer.from(screenshot)
    } finally {
      await browser.close().catch(() => {})
    }
  }
}

export function getPuppeteerCapturer(): ThumbnailCapturer {
  return new PuppeteerCapturer()
}
