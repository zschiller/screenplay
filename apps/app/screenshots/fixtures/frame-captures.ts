import { mkdir, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import sharp from "sharp"

/**
 * Synthetic **Frame Captures** for the Fixture World's Thumbnail Manifests.
 *
 * A Room's home-grid card is composed at display time from its manifest (#468):
 * each Iframe Layer's rect paired with the last screenshot of that frame. With no
 * captures every card falls back to branch-tinted placeholders, which hides the
 * compositor — the exact thing a home-grid polish ticket needs to see.
 *
 * Real captures would mean booting a dev server per Workspace, so these are
 * *drawn*: an SVG wireframe rasterised through `sharp` (already a dependency, for
 * the same thumbnail pipeline) into the local-fs blob dir the sidecar serves at
 * `/blobs`. Generated rather than committed so no binary fixtures enter the repo,
 * and deterministic — the same frame always yields byte-identical output — so a
 * re-seed never shows up as a diff in a before/after pair.
 *
 * They are honest about being fixtures: a flat wireframe, never a mock of a real
 * product screen.
 */

/** Blob key prefix, so the whole fixture set is recognisable (and sweepable). */
const KEY_PREFIX = "screenshot-fixtures"

export interface FrameCaptureRequest {
  /** Iframe Layer id — also the blob key, so a frame's capture is findable. */
  layerId: string
  /** The rect the capture is "shot at". Must match the frame's live size, or
   *  `buildThumbnailManifest` discards it as size-drifted. */
  width: number
  height: number
  label: string
  /** Index into the branch palette, only used to tint the wireframe's accent. */
  paletteIndex: number | null
}

export interface RenderedFrameCapture {
  layerId: string
  /** The URL the manifest stores, origin-relative so it survives a port change. */
  url: string
  width: number
  height: number
}

/**
 * A small, theme-neutral accent ramp. Deliberately independent of
 * `lib/branch-colors` — these are pixels baked into an image that both themes
 * display, so they need mid-tone hues that read on either background, not the
 * theme-aware CSS variables the live placeholders use.
 */
const ACCENTS = [
  "#6366f1",
  "#0ea5e9",
  "#14b8a6",
  "#f59e0b",
  "#ec4899",
  "#8b5cf6",
  "#ef4444",
  "#22c55e",
]

/**
 * Render every requested capture into `blobDir` and return what the manifest
 * needs. Writes through plain `fs` rather than `lib/blob` because that module is
 * `server-only` — it refuses to load outside an RSC bundle — while the key/URL
 * shape here is exactly the local-fs store's (`${baseUrl}/${key}`), so the
 * `/blobs` route serves them unchanged.
 */
export async function renderFrameCaptures(
  requests: FrameCaptureRequest[],
  blobDir: string,
  baseUrl: string
): Promise<RenderedFrameCapture[]> {
  const out: RenderedFrameCapture[] = []
  for (const request of requests) {
    const key = `${KEY_PREFIX}/${request.layerId}.webp`
    const path = join(blobDir, key)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, await renderWireframe(request))
    out.push({
      layerId: request.layerId,
      url: `${baseUrl.replace(/\/+$/, "")}/${key}`,
      width: request.width,
      height: request.height,
    })
  }
  return out
}

/**
 * Rasterise one frame's wireframe. Rendered at a capped width (the card never
 * shows more than a few hundred px) but at the frame's true aspect ratio, so the
 * compositor's `object-cover` has nothing to crop.
 */
async function renderWireframe(request: FrameCaptureRequest): Promise<Buffer> {
  const maxWidth = 640
  const scale = Math.min(1, maxWidth / request.width)
  const width = Math.max(1, Math.round(request.width * scale))
  const height = Math.max(1, Math.round(request.height * scale))
  return sharp(Buffer.from(wireframeSvg(request, width, height)))
    .webp({ quality: 80 })
    .toBuffer()
}

/**
 * The wireframe itself: a title bar, a hero block in the frame's accent, and a
 * few content bars sized to the frame — narrow frames get a single column, wide
 * ones a sidebar. Enough structure that a composed card reads as "a screen",
 * with no pretence of being a real one.
 */
function wireframeSvg(
  request: FrameCaptureRequest,
  width: number,
  height: number
): string {
  const accent =
    request.paletteIndex == null
      ? "#94a3b8"
      : ACCENTS[Math.abs(request.paletteIndex) % ACCENTS.length]!
  const narrow = width < 420
  const pad = Math.round(width * 0.06)
  const barHeight = Math.round(height * 0.055)
  const chromeHeight = Math.round(height * 0.07)
  const heroTop = chromeHeight + pad
  const heroHeight = Math.round(height * 0.26)
  const bodyTop = heroTop + heroHeight + pad
  const columnWidth = narrow
    ? width - pad * 2
    : Math.round((width - pad * 3) * 0.62)
  const asideLeft = pad + columnWidth + pad
  const asideWidth = width - asideLeft - pad

  const rows = Array.from({ length: narrow ? 5 : 4 }, (_, i) => {
    const y = bodyTop + i * (barHeight + Math.round(barHeight * 0.6))
    if (y + barHeight > height - pad) return ""
    const w = columnWidth * (i % 2 === 0 ? 1 : 0.72)
    return `<rect x="${pad}" y="${y}" width="${Math.round(w)}" height="${barHeight}" rx="${Math.round(barHeight / 3)}" fill="#cbd5e1"/>`
  }).join("")

  const aside =
    narrow || asideWidth <= 0
      ? ""
      : `<rect x="${asideLeft}" y="${bodyTop}" width="${asideWidth}" height="${height - bodyTop - pad}" rx="${pad / 2}" fill="#e2e8f0"/>`

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#f8fafc"/>
  <rect width="${width}" height="${chromeHeight}" fill="#e2e8f0"/>
  ${[0, 1, 2]
    .map(
      (i) =>
        `<circle cx="${pad + i * (pad * 0.6)}" cy="${chromeHeight / 2}" r="${Math.max(2, Math.round(chromeHeight * 0.12))}" fill="#cbd5e1"/>`
    )
    .join("")}
  <rect x="${pad}" y="${heroTop}" width="${width - pad * 2}" height="${heroHeight}" rx="${pad / 2}" fill="${accent}" fill-opacity="0.9"/>
  ${rows}
  ${aside}
</svg>`
}
