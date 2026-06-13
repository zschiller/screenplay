import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { IframeLayerLayout } from "@/lib/canvas/layout"
import { resolveBranchColorIndex } from "@/lib/branch-colors"
import type { ThumbnailCapturer } from "./capturer"
import type { RoomCaptureLayout } from "./room-layout"

// The capture path composes three server-only seams around the per-frame
// screenshot: the room's Y.Doc layout read, the blob store, and the Room write.
// Stub all three so what's under test is the shared orchestration — read layout,
// drive the capturer once per ready frame, resize, store, build + persist the
// manifest — not the Yjs round-trip or the DB. `sharp` runs for real, proving
// each capture is still resized to a webp behind the extracted seam.
type PutCall = [
  key: string,
  body: Buffer | Uint8Array,
  opts: { contentType: string; cacheControlMaxAge?: number },
]

const { put, setRoomThumbnailManifest, readRoomCaptureLayout } = vi.hoisted(
  () => ({
    put: vi.fn((key: string) =>
      Promise.resolve({ url: `https://blob.example/${key}` })
    ),
    setRoomThumbnailManifest: vi.fn(() => Promise.resolve()),
    readRoomCaptureLayout: vi.fn(),
  })
)

vi.mock("@/lib/blob", () => ({ blobStore: { put } }))
vi.mock("@/lib/rooms", () => ({ setRoomThumbnailManifest }))
vi.mock("./room-layout", () => ({ readRoomCaptureLayout }))

import sharp from "sharp"
import { captureRoomThumbnail } from "./capture"

/** A layout-map entry with the fields the manifest ignores defaulted. */
function layout(
  id: string,
  rect: { x: number; y: number; width: number; height: number }
): IframeLayerLayout {
  return {
    id,
    kind: "iframe-layer",
    groupId: "g1",
    index: 0,
    isLast: true,
    ...rect,
  }
}

/** A real PNG so `sharp` has something to resize. */
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

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe("captureRoomThumbnail", () => {
  it("captures every ready frame, stores each, and persists a composed manifest", async () => {
    const png = await fakePng()
    const capturer: ThumbnailCapturer = { capture: vi.fn(async () => png) }

    const captureLayout: RoomCaptureLayout = {
      layouts: new Map([
        ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
        ["b", layout("b", { x: 420, y: 0, width: 400, height: 300 })],
      ]),
      frames: [
        {
          id: "a",
          label: "Home",
          previewUrl: "https://a.preview.example/",
          branchKey: "branch-a",
        },
        {
          id: "b",
          label: "Settings",
          previewUrl: "https://b.preview.example/settings",
          branchKey: "branch-b",
          branchColorIndex: 3,
        },
      ],
    }
    readRoomCaptureLayout.mockResolvedValue(captureLayout)

    const manifest = await captureRoomThumbnail("room-1", capturer)

    // 1. The capturer was driven once per frame, with each frame's preview URL.
    const captureFn = capturer.capture as ReturnType<typeof vi.fn>
    expect(captureFn).toHaveBeenCalledTimes(2)
    expect(captureFn.mock.calls.map((c) => c[0])).toEqual([
      "https://a.preview.example/",
      "https://b.preview.example/settings",
    ])

    // 2. Each screenshot was resized to a webp and stored under a per-frame key.
    expect(put).toHaveBeenCalledTimes(2)
    const keys = (put.mock.calls as unknown as PutCall[]).map((c) => c[0])
    expect(keys).toEqual([
      "thumbnails/room-1/a.webp",
      "thumbnails/room-1/b.webp",
    ])
    const [, body, opts] = put.mock.calls[0] as unknown as PutCall
    expect(opts).toEqual({ contentType: "image/webp", cacheControlMaxAge: 60 })
    const webp = body as Buffer
    expect(webp.toString("ascii", 0, 4)).toBe("RIFF")
    expect(webp.toString("ascii", 8, 12)).toBe("WEBP")

    // 3. The persisted manifest places each frame with its stored capture.
    expect(setRoomThumbnailManifest).toHaveBeenCalledTimes(1)
    const [persistedRoomId, persisted] = setRoomThumbnailManifest.mock
      .calls[0] as unknown as [string, typeof manifest]
    expect(persistedRoomId).toBe("room-1")
    expect(persisted).toBe(manifest)
    expect(manifest.frames).toEqual([
      {
        id: "a",
        label: "Home",
        x: 0,
        y: 0,
        width: 400,
        height: 300,
        paletteIndex: resolveBranchColorIndex("branch-a"),
        capture: { url: "https://blob.example/thumbnails/room-1/a.webp" },
      },
      {
        id: "b",
        label: "Settings",
        x: 420,
        y: 0,
        width: 400,
        height: 300,
        paletteIndex: 3,
        capture: { url: "https://blob.example/thumbnails/room-1/b.webp" },
      },
    ])
  })

  it("skips frames with no preview URL, recording them captureless in the manifest", async () => {
    const png = await fakePng()
    const capturer: ThumbnailCapturer = { capture: vi.fn(async () => png) }

    readRoomCaptureLayout.mockResolvedValue({
      layouts: new Map([
        ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
        ["b", layout("b", { x: 420, y: 0, width: 400, height: 300 })],
      ]),
      frames: [
        {
          id: "a",
          label: "Home",
          previewUrl: "https://a.preview.example/",
          branchKey: "branch-a",
        },
        { id: "b", label: "Booting", previewUrl: null, branchKey: "branch-b" },
      ],
    } satisfies RoomCaptureLayout)

    const manifest = await captureRoomThumbnail("room-1", capturer)

    expect(capturer.capture).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledTimes(1)
    expect(manifest.frames[0]!.capture).toEqual({
      url: "https://blob.example/thumbnails/room-1/a.webp",
    })
    // The booting frame lands captureless but still carries its placeholder tint.
    expect(manifest.frames[1]!.capture).toBeNull()
    expect(manifest.frames[1]!.paletteIndex).toBe(
      resolveBranchColorIndex("branch-b")
    )
  })

  it("skips a frame whose capture throws, persisting every other frame's capture", async () => {
    const png = await fakePng()
    // Frame "a" captures fine; frame "b" (a still-booting dev server) throws.
    const capturer: ThumbnailCapturer = {
      capture: vi.fn(async (url: string) => {
        if (url.includes("b.preview")) throw new Error("nav timeout")
        return png
      }),
    }

    readRoomCaptureLayout.mockResolvedValue({
      layouts: new Map([
        ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
        ["b", layout("b", { x: 420, y: 0, width: 400, height: 300 })],
      ]),
      frames: [
        {
          id: "a",
          label: "Home",
          previewUrl: "https://a.preview.example/",
          branchKey: "branch-a",
        },
        {
          id: "b",
          label: "Booting",
          previewUrl: "https://b.preview.example/",
          branchKey: "branch-b",
        },
      ],
    } satisfies RoomCaptureLayout)

    const manifest = await captureRoomThumbnail("room-1", capturer)

    // The round still completed and persisted, with only the good frame stored.
    expect(setRoomThumbnailManifest).toHaveBeenCalledTimes(1)
    expect(put).toHaveBeenCalledTimes(1)
    expect((put.mock.calls[0] as unknown as PutCall)[0]).toBe(
      "thumbnails/room-1/a.webp"
    )
    expect(manifest.frames[0]!.capture).toEqual({
      url: "https://blob.example/thumbnails/room-1/a.webp",
    })
    expect(manifest.frames[1]!.capture).toBeNull()
  })

  it("skips a frame whose capture never resolves within the timeout", async () => {
    vi.useFakeTimers()
    // The capturer hangs — a booting preview that never signals ready. The
    // orchestration's per-frame timeout is the only thing that ends the round.
    const capturer: ThumbnailCapturer = {
      capture: vi.fn(() => new Promise<Buffer>(() => {})),
    }

    readRoomCaptureLayout.mockResolvedValue({
      layouts: new Map([
        ["a", layout("a", { x: 0, y: 0, width: 400, height: 300 })],
      ]),
      frames: [
        {
          id: "a",
          label: "Booting",
          previewUrl: "https://a.preview.example/",
          branchKey: "branch-a",
        },
      ],
    } satisfies RoomCaptureLayout)

    const pending = captureRoomThumbnail("room-1", capturer)
    // Advance past the per-frame ceiling so the timeout rejects and the frame
    // is skipped rather than blocking the round forever.
    await vi.advanceTimersByTimeAsync(31_000)
    const manifest = await pending

    expect(put).not.toHaveBeenCalled()
    expect(setRoomThumbnailManifest).toHaveBeenCalledTimes(1)
    expect(manifest.frames).toHaveLength(1)
    expect(manifest.frames[0]!.capture).toBeNull()
  })
})
