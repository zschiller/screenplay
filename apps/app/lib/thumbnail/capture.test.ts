import { beforeEach, describe, expect, it, vi } from "vitest"

import type { ThumbnailCapturer } from "./capturer"

// The capture path composes two server-only seams around the screenshot: the
// blob store and the Room write. Stub both so what's under test is the shared
// orchestration — drive an injected capturer, resize, store, record — not the
// Vercel round-trip or the DB it would otherwise drag in. `sharp` runs for
// real, proving the resize step still happens behind the extracted seam.
type PutCall = [
  key: string,
  body: Buffer | Uint8Array,
  opts: { contentType: string; cacheControlMaxAge?: number },
]

const { put, setRoomThumbnail } = vi.hoisted(() => ({
  put: vi.fn(() =>
    Promise.resolve({ url: "https://blob.example/thumbnails/room-1.webp" })
  ),
  setRoomThumbnail: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/blob", () => ({ blobStore: { put } }))
vi.mock("@/lib/rooms", () => ({ setRoomThumbnail }))

import sharp from "sharp"
import { captureRoomThumbnail } from "./capture"

beforeEach(() => {
  vi.clearAllMocks()
  process.env.THUMBNAIL_RENDER_SECRET = "test-secret"
})

/** A real PNG the size of the capture viewport, so `sharp` has something to resize. */
async function fakePng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 1280,
      height: 960,
      channels: 3,
      background: { r: 12, g: 34, b: 56 },
    },
  })
    .png()
    .toBuffer()
}

describe("captureRoomThumbnail", () => {
  it("drives the injected capturer and runs the shared resize/store/record orchestration", async () => {
    const png = await fakePng()
    const capturer: ThumbnailCapturer = {
      capture: vi.fn(async () => png),
    }

    const url = await captureRoomThumbnail("room-1", capturer)

    // 1. The capturer was driven with the Room's render URL (basePath + token).
    expect(capturer.capture).toHaveBeenCalledTimes(1)
    const renderUrl = (capturer.capture as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as string
    expect(renderUrl).toContain("/room-1/render?token=")

    // 2. The screenshot was resized to a webp and handed to BlobStore.put under
    //    the per-Room key — the resize/store orchestration is still shared.
    expect(put).toHaveBeenCalledTimes(1)
    const [key, body, opts] = put.mock.calls[0] as unknown as PutCall
    expect(key).toBe("thumbnails/room-1.webp")
    expect(opts).toEqual({ contentType: "image/webp", cacheControlMaxAge: 60 })
    // A real webp came out of `sharp` (RIFF....WEBP magic bytes).
    const webp = body as Buffer
    expect(webp.toString("ascii", 0, 4)).toBe("RIFF")
    expect(webp.toString("ascii", 8, 12)).toBe("WEBP")
    const meta = await sharp(webp).metadata()
    expect(meta.format).toBe("webp")
    expect(meta.width).toBe(640)
    expect(meta.height).toBe(480)

    // 3. The stored URL was recorded on the Room and returned.
    expect(setRoomThumbnail).toHaveBeenCalledWith(
      "room-1",
      "https://blob.example/thumbnails/room-1.webp"
    )
    expect(url).toBe("https://blob.example/thumbnails/room-1.webp")
  })
})
