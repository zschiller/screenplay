import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import sharp from "sharp"

import type {
  FrameCaptureRequest,
  RenderedFrameCapture,
} from "../fixtures/frame-captures"
import type { FixtureWorld } from "../fixtures/world"
import { launchBrowser } from "../lib/browser"

/** Width a capture is stored at; the home grid's cards never show more. */
const MAX_WIDTH = 640

/**
 * A Frame Capture renderer that photographs each frame's real preview, so the
 * docs' home grid shows the demo site rather than wireframes. It stands in for
 * the app's own thumbnail capturer, which does the same thing with headless
 * Chromium once a Canvas has been open for a while.
 *
 * The previews must already be serving when the seeder calls this.
 */
export function photographPreviews(world: FixtureWorld) {
  const urls = new Map<string, string>()
  for (const room of world.rooms) {
    const branches = new Map((room.doc?.branches ?? []).map((b) => [b.id, b]))
    for (const layer of room.doc?.iframeLayers ?? []) {
      const branch = layer.branchId ? branches.get(layer.branchId) : undefined
      if (branch?.previewDomain) {
        urls.set(layer.id, `${branch.previewDomain}${layer.route ?? "/"}`)
      }
    }
  }

  return async function renderCaptures(
    requests: FrameCaptureRequest[],
    blobDir: string,
    baseUrl: string
  ): Promise<RenderedFrameCapture[]> {
    const browser = await launchBrowser()
    const out: RenderedFrameCapture[] = []
    try {
      for (const request of requests) {
        const url = urls.get(request.layerId)
        if (!url) continue
        const page = await browser.newPage({
          viewport: { width: request.width, height: request.height },
        })
        await page.goto(url, { waitUntil: "networkidle" })
        await page.evaluate("document.fonts.ready")
        const png = await page.screenshot()
        await page.close()

        const key = `docs-fixtures/${request.layerId}.webp`
        const path = join(blobDir, key)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(
          path,
          await sharp(png)
            .resize({ width: Math.min(MAX_WIDTH, request.width) })
            .webp({ quality: 82 })
            .toBuffer()
        )
        out.push({
          layerId: request.layerId,
          url: `${baseUrl.replace(/\/+$/, "")}/${key}`,
          width: request.width,
          height: request.height,
        })
      }
    } finally {
      await browser.close()
    }
    return out
  }
}
