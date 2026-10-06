/**
 * **Image density**: how many image pixels a picture means per CSS pixel, so
 * a retina screenshot (2880px wide, taken on a 1440pt screen) shows at the
 * size it was on screen rather than twice that.
 *
 * The hints, strongest first:
 * 1. A PNG's `pHYs` chunk saying more than 96dpi. macOS screenshots say 144.
 *    72 and 96dpi are what tools write when they mean nothing, so they aren't
 *    hints.
 * 2. `@2x` / `@3x` before the extension, the asset naming convention.
 * 3. A picture wider than {@link WIDE_IMAGE_PX} is taken to be 2x: it's almost
 *    always a screenshot from a retina screen, and at 1x it fills the column
 *    anyway.
 *
 * The node view caps the result at the column width either way.
 */

/** Wider than this, with no other hint, an image is taken to be 2x. */
export const WIDE_IMAGE_PX = 1000

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const INCHES_PER_METRE = 39.3701

/**
 * The density a PNG's `pHYs` chunk states, or null when it has none, states
 * 1x (96dpi or less), or `bytes` isn't a PNG. `bytes` can be just the start
 * of the file: `pHYs` must come before the first `IDAT`.
 */
export function pngDensity(bytes: Uint8Array): number | null {
  if (bytes.length < 8 || PNG_SIGNATURE.some((b, i) => bytes[i] !== b)) {
    return null
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 8
  while (at + 8 <= bytes.length) {
    const length = view.getUint32(at)
    const type = String.fromCharCode(...bytes.subarray(at + 4, at + 8))
    if (type === "IDAT" || type === "IEND") return null
    if (type === "pHYs") {
      if (at + 8 + 9 > bytes.length) return null
      const perUnitX = view.getUint32(at + 8)
      const unit = bytes[at + 16]
      // Unit 0 is only an aspect ratio.
      if (unit !== 1) return null
      const ratio = perUnitX / INCHES_PER_METRE / 72
      // 96dpi is Windows' nothing-in-particular, so it's 1x too.
      return ratio > 1.4 ? Math.round(ratio * 2) / 2 : null
    }
    at += 12 + length
  }
  return null
}

/** The density an `@2x` / `@3x` file name states, or null. */
export function fileNameDensity(src: string): number | null {
  const path = src.split(/[?#]/)[0]!
  const match = /@([1-4](?:\.5)?)x\.[a-z0-9]+$/i.exec(path)
  if (!match) return null
  const density = Number(match[1])
  return density > 1 ? density : null
}

/**
 * The density to show an image at: the PNG's own hint, then its name's, then
 * 2x for a wide one, else 1x.
 */
export function imageDensity({
  src,
  naturalWidth,
  png,
}: {
  src: string
  naturalWidth: number
  png: number | null
}): number {
  return png ?? fileNameDensity(src) ?? (naturalWidth > WIDE_IMAGE_PX ? 2 : 1)
}

/** Enough of a PNG to reach `pHYs`, which sits before the pixel data. */
const HEAD_BYTES = 64 * 1024

const pngDensities = new Map<string, Promise<number | null>>()

/**
 * Read the start of the image at `url` and return its `pHYs` density, once
 * per URL. Null when it isn't a PNG, has no hint, or can't be fetched (a web
 * image on a host that doesn't allow it).
 */
export function fetchPngDensity(url: string): Promise<number | null> {
  let density = pngDensities.get(url)
  if (!density) {
    density = readHead(url)
      .then(pngDensity)
      .catch(() => null)
    pngDensities.set(url, density)
  }
  return density
}

async function readHead(url: string): Promise<Uint8Array> {
  const response = await fetch(url)
  if (!response.ok || !response.body) return new Uint8Array()
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  while (length < HEAD_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    length += value.length
  }
  void reader.cancel().catch(() => {})
  const head = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    head.set(chunk, at)
    at += chunk.length
  }
  return head
}
