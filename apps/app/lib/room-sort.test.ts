import { describe, expect, it } from "vitest"
import { lastEditedAt, sortRooms, type RoomSortable } from "@/lib/room-sort"

function room(
  name: string,
  createdAt: number,
  lastConnectionAt: number | null = null
): RoomSortable {
  return { name, createdAt, lastConnectionAt }
}

describe("lastEditedAt", () => {
  it("is the later of last connection and creation", () => {
    expect(lastEditedAt(room("a", 100, 200))).toBe(200)
  })

  it("is the created timestamp when that is later than the last connection", () => {
    expect(lastEditedAt(room("a", 300, 200))).toBe(300)
  })

  it("falls back to the created timestamp for a never-opened room", () => {
    expect(lastEditedAt(room("a", 100, null))).toBe(100)
  })
})

describe("sortRooms", () => {
  describe("updated", () => {
    it("orders rooms by last-edited instant, most recent first", () => {
      const rooms = [
        room("old", 100, 150),
        room("newest", 100, 900),
        room("middle", 100, 500),
      ]

      const ordered = sortRooms(rooms, "updated").map((r) => r.name)

      expect(ordered).toEqual(["newest", "middle", "old"])
    })

    it("ranks a never-opened room by its created timestamp", () => {
      // "fresh" was created after "stale" was last opened, so it sorts first
      // even though it has no last-connection timestamp.
      const rooms = [room("stale", 100, 400), room("fresh", 500, null)]

      const ordered = sortRooms(rooms, "updated").map((r) => r.name)

      expect(ordered).toEqual(["fresh", "stale"])
    })

    it("uses the created timestamp when it is later than the last connection", () => {
      // max(lastConnection, created): "b" was created at 600, after "a" was
      // last opened at 500, so b's stale last-connection (50) must not bury it.
      const rooms = [room("a", 100, 500), room("b", 600, 50)]

      const ordered = sortRooms(rooms, "updated").map((r) => r.name)

      expect(ordered).toEqual(["b", "a"])
    })

    it("keeps the incoming order for equal last-edited instants", () => {
      const rooms = [room("first", 100, 500), room("second", 500, null)]

      const ordered = sortRooms(rooms, "updated").map((r) => r.name)

      expect(ordered).toEqual(["first", "second"])
    })
  })

  describe("created", () => {
    it("orders rooms by created timestamp, newest first", () => {
      const rooms = [room("b", 200), room("c", 300), room("a", 100)]

      const ordered = sortRooms(rooms, "created").map((r) => r.name)

      expect(ordered).toEqual(["c", "b", "a"])
    })

    it("ignores last-connection timestamps", () => {
      // "older" was opened recently, but creation date alone decides.
      const rooms = [room("older", 100, 900), room("newer", 200, null)]

      const ordered = sortRooms(rooms, "created").map((r) => r.name)

      expect(ordered).toEqual(["newer", "older"])
    })

    it("keeps the incoming order for equal created timestamps", () => {
      const rooms = [room("first", 100), room("second", 100)]

      const ordered = sortRooms(rooms, "created").map((r) => r.name)

      expect(ordered).toEqual(["first", "second"])
    })
  })

  describe("name", () => {
    it("orders rooms alphabetically, locale-aware", () => {
      const rooms = [room("charlie", 1), room("alpha", 2), room("bravo", 3)]

      const ordered = sortRooms(rooms, "name").map((r) => r.name)

      expect(ordered).toEqual(["alpha", "bravo", "charlie"])
    })

    it("keeps the incoming order for equal names", () => {
      const rooms = [
        room("dupe", 100, 900),
        room("dupe", 200, null),
        room("aardvark", 300),
      ]

      const ordered = sortRooms(rooms, "name")

      expect(ordered.map((r) => r.name)).toEqual(["aardvark", "dupe", "dupe"])
      expect(ordered[1]!.createdAt).toBe(100)
      expect(ordered[2]!.createdAt).toBe(200)
    })
  })

  it("does not mutate the input list", () => {
    const rooms = [room("b", 200), room("a", 100)]

    sortRooms(rooms, "created")

    expect(rooms.map((r) => r.name)).toEqual(["b", "a"])
  })
})
