import "server-only"

import sharp from "sharp"
import { blobStore } from "@/lib/blob"
import { getRoom, setRoomThumbnailManifest } from "@/lib/rooms"
import {
  buildThumbnailManifest,
  type FrameCapture,
  type ThumbnailManifest,
} from "./manifest"
import { readRoomCaptureLayout } from "./room-layout"
import { thumbnailCapturer, type ThumbnailCapturer } from "./capturer"

// The longest side a stored Frame Capture is resized to. The homescreen grid
// scales each capture into a small card, so a frame-sized webp is plenty —
// keeping the blobs small keeps the per-Room manifest read cheap to render.
const MAX_FRAME_DIM = 512

// Hard ceiling on a single frame's capture. The capturers carry their own,
// finer-grained nav/ready timeouts, but a still-booting dev server can hang the
// screenshot past those; this is the orchestration's last-resort skip so one
// slow frame never blocks the round. Comfortably above the puppeteer
// capturer's internal budget so it only fires on a genuine hang.
const FRAME_CAPTURE_TIMEOUT_MS = 30_000

/** Reject `p` if it hasn't settled within `ms` — the per-frame capture ceiling. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms
    )
  })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Capture a Room's thumbnail as a per-frame composite. Reads the room's layout
 * once (`readRoomCaptureLayout`), screenshots each ready Iframe Layer's live
 * preview URL through the injected {@link ThumbnailCapturer} seam — called once
 * per frame — resizes and stores each capture, then builds and persists the
 * {@link ThumbnailManifest} on the Room row. No single baked `thumbnailUrl`
 * anymore: the grid composes positioned images from the manifest at display
 * time.
 *
 * The round degrades gracefully (#469): a frame with no preview URL, or whose
 * capture times out or throws (a still-booting dev server), is **skipped** — it
 * never blocks the round or fails the whole thumbnail. One frame failing leaves
 * every other frame's capture intact.
 *
 * Each Iframe Layer has a stable identity keyed by its id (#470): a frame that
 * captures this round overwrites only its own image + timestamp, while a frame
 * that doesn't retains its last-good capture from the previous manifest instead
 * of reverting to a placeholder — so a transiently booting or failing frame
 * keeps the screenshot it had. A frame removed from the canvas drops out. The
 * merge/retain/prune logic lives in {@link buildThumbnailManifest}; here we read
 * the previous manifest and hand it the current layout + this round's fresh
 * captures. The `sharp` resize, `BlobStore.put`, and Room write are shared across
 * capturers, so a sibling capturer (the desktop Tauri-webview one) stays a
 * drop-in.
 *
 * `options.frameIds` bounds the round to a **dirty subset** (#474): when set,
 * only those frames are screenshotted and every other placed frame keeps its
 * prior capture through the same retain merge — so a heartbeat fire pays for the
 * frames that changed, not the whole Room. `undefined` recaptures every ready
 * frame (the initial/unmount full fires); an empty array captures nothing and
 * just rebuilds the manifest from the current layout (a moved or renamed frame),
 * opening no browser at all.
 */
export async function captureRoomThumbnail(
  roomId: string,
  capturer: ThumbnailCapturer = thumbnailCapturer,
  options?: { frameIds?: readonly string[] }
): Promise<ThumbnailManifest> {
  const [{ layouts, frames }, previousRoom] = await Promise.all([
    readRoomCaptureLayout(roomId),
    getRoom(roomId),
  ])

  // The dirty subset to recapture this round, or `null` to recapture all. A
  // frame outside the subset is left uncaptured here and keeps its prior image
  // via the retain merge below; an empty subset captures nothing at all.
  const dirtySet = options?.frameIds ? new Set(options.frameIds) : null

  // One timestamp for the whole round — every blob written below is current as
  // of this moment, and a shared value keeps the manifest's capture times tidy.
  const capturedAt = Date.now()
  const captures = new Map<string, FrameCapture>()
  for (const frame of frames) {
    const layout = layouts.get(frame.id)
    if (!frame.previewUrl || !layout) continue
    if (dirtySet && !dirtySet.has(frame.id)) continue

    try {
      // Capture at the frame's own shape so the screenshot shares its aspect
      // ratio — the iframe on the canvas renders its page at exactly these
      // dimensions, so this reproduces what the user sees rather than a fixed
      // viewport cropped to fit.
      const pngBuffer = await withTimeout(
        capturer.capture(frame.previewUrl, {
          width: layout.width,
          height: layout.height,
        }),
        FRAME_CAPTURE_TIMEOUT_MS,
        `frame ${frame.id} capture`
      )

      // Downscale to the frame's rect, capped at MAX_FRAME_DIM on the long side.
      // The capture already shares the frame's aspect ratio, so `cover` only
      // shrinks here (and absorbs any sub-pixel rounding) rather than cropping.
      const scale = Math.min(
        1,
        MAX_FRAME_DIM / Math.max(layout.width, layout.height)
      )
      const webp = await sharp(pngBuffer)
        .resize(
          Math.round(layout.width * scale),
          Math.round(layout.height * scale),
          { fit: "cover" }
        )
        .webp({ quality: 80 })
        .toBuffer()

      const { url } = await blobStore.put(
        `thumbnails/${roomId}/${frame.id}.webp`,
        webp,
        { contentType: "image/webp", cacheControlMaxAge: 60 }
      )
      captures.set(frame.id, { url, capturedAt })
    } catch (err) {
      // Skip this frame and keep going: it lands in the manifest captureless
      // (a branch-tinted placeholder) and every other frame's capture survives.
      console.warn(
        `[thumbnail] skipping frame ${frame.id} in room ${roomId}:`,
        err
      )
    }
  }

  const manifest = buildThumbnailManifest(
    layouts,
    frames,
    captures,
    previousRoom?.thumbnailManifest ?? null
  )
  // A layout-only round (empty subset, no browser) rewrites just the rects, so
  // it must not bump the capture clock — otherwise a stream of layout writes
  // would starve the route's capture cooldown (#474). Any round that could have
  // captured pixels (a non-empty subset, or a full `undefined` round) touches it.
  const layoutOnly = options?.frameIds?.length === 0
  await setRoomThumbnailManifest(roomId, manifest, !layoutOnly)
  return manifest
}
