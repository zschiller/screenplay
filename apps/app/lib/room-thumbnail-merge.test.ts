import { describe, expect, it } from "vitest"
import {
  mergeRoomThumbnails,
  type RoomThumbnail,
} from "@/lib/room-thumbnail-merge"
import type { ThumbnailManifest } from "@/lib/thumbnail/manifest"

function manifest(label: string, revision?: number): ThumbnailManifest {
  return {
    version: 2,
    ...(revision != null ? { revision } : {}),
    bounds: { x: 0, y: 0, width: 100, height: 100 },
    frames: [
      {
        id: "f1",
        label,
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        paletteIndex: null,
        capture: null,
      },
    ],
  }
}

type Room = RoomThumbnail & { name: string }

function room(
  id: string,
  thumbnailUpdatedAt: number | null,
  thumbnailManifest: ThumbnailManifest | null = null,
  name = id
): Room {
  return { id, name, thumbnailUpdatedAt, thumbnailManifest }
}

describe("mergeRoomThumbnails", () => {
  it("adopts a strictly newer capture's manifest and time", () => {
    const before = manifest("old")
    const after = manifest("new")
    const rooms = [room("a", 100, before)]

    const merged = mergeRoomThumbnails(rooms, [
      { id: "a", thumbnailUpdatedAt: 200, thumbnailManifest: after },
    ])

    expect(merged[0]).toMatchObject({
      id: "a",
      thumbnailUpdatedAt: 200,
      thumbnailManifest: after,
    })
  })

  it("preserves non-thumbnail fields and list order", () => {
    const rooms = [room("a", 100, null, "Alpha"), room("b", 100, null, "Beta")]

    const merged = mergeRoomThumbnails(rooms, [
      { id: "b", thumbnailUpdatedAt: 200, thumbnailManifest: manifest("b") },
    ])

    expect(merged.map((r) => r.id)).toEqual(["a", "b"])
    expect(merged[0]!.name).toBe("Alpha")
    expect(merged[1]!.name).toBe("Beta")
  })

  it("returns the same array reference when nothing is newer", () => {
    const rooms = [room("a", 200, manifest("a"))]

    // Equal capture time is a no-op; an older one likewise.
    const equal = mergeRoomThumbnails(rooms, [
      {
        id: "a",
        thumbnailUpdatedAt: 200,
        thumbnailManifest: manifest("stale"),
      },
    ])
    const older = mergeRoomThumbnails(rooms, [
      { id: "a", thumbnailUpdatedAt: 50, thumbnailManifest: manifest("stale") },
    ])

    expect(equal).toBe(rooms)
    expect(older).toBe(rooms)
  })

  it("leaves rooms absent from the poll untouched, by identity", () => {
    const kept = room("a", 100, manifest("a"))
    const rooms = [kept, room("b", 100, manifest("b"))]

    const merged = mergeRoomThumbnails(rooms, [
      { id: "b", thumbnailUpdatedAt: 200, thumbnailManifest: manifest("b2") },
    ])

    expect(merged).not.toBe(rooms)
    expect(merged[0]).toBe(kept)
  })

  it("treats a null capture time as the oldest, so a first capture lands", () => {
    const rooms = [room("a", null, null)]

    const merged = mergeRoomThumbnails(rooms, [
      { id: "a", thumbnailUpdatedAt: 1, thumbnailManifest: manifest("first") },
    ])

    expect(merged).not.toBe(rooms)
    expect(merged[0]!.thumbnailUpdatedAt).toBe(1)
    expect(merged[0]!.thumbnailManifest).toEqual(manifest("first"))
  })

  it("is a no-op for an empty poll", () => {
    const rooms = [room("a", 100, manifest("a"))]
    expect(mergeRoomThumbnails(rooms, [])).toBe(rooms)
  })

  it("adopts a newer-revision manifest even when the capture time is unchanged", () => {
    // The layout lane's signature: a moved/renamed frame bumps the manifest's
    // revision but deliberately leaves `thumbnailUpdatedAt` alone. Gating on the
    // capture clock would discard it; the revision must carry it through.
    const rooms = [room("a", 200, manifest("old", 5))]

    const merged = mergeRoomThumbnails(rooms, [
      { id: "a", thumbnailUpdatedAt: 200, thumbnailManifest: manifest("moved", 6) },
    ])

    expect(merged).not.toBe(rooms)
    expect(merged[0]!.thumbnailManifest).toEqual(manifest("moved", 6))
  })

  it("ignores an equal-or-older revision, even on a newer capture time", () => {
    const rooms = [room("a", 100, manifest("current", 6))]

    const equal = mergeRoomThumbnails(rooms, [
      { id: "a", thumbnailUpdatedAt: 999, thumbnailManifest: manifest("stale", 6) },
    ])
    const older = mergeRoomThumbnails(rooms, [
      { id: "a", thumbnailUpdatedAt: 999, thumbnailManifest: manifest("stale", 4) },
    ])

    expect(equal).toBe(rooms)
    expect(older).toBe(rooms)
  })

  it("prefers a revisioned manifest over a legacy revisionless one", () => {
    const rooms = [room("a", 500, manifest("legacy"))]

    const merged = mergeRoomThumbnails(rooms, [
      { id: "a", thumbnailUpdatedAt: 100, thumbnailManifest: manifest("fresh", 1) },
    ])

    expect(merged).not.toBe(rooms)
    expect(merged[0]!.thumbnailManifest).toEqual(manifest("fresh", 1))
  })
})
