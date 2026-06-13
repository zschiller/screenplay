import { describe, expect, it } from "vitest"
import {
  ancestorChain,
  foldersInParent,
  roomsInFolder,
  sortFolders,
  type FolderNode,
  type PlacedRoom,
} from "@/lib/folder-tree"

function folder(
  name: string,
  {
    parentFolderId = null,
    createdAt = 0,
    updatedAt = createdAt,
  }: {
    parentFolderId?: string | null
    createdAt?: number
    updatedAt?: number
  } = {}
): FolderNode & { id: string } {
  return { id: name, name, parentFolderId, createdAt, updatedAt }
}

function placedRoom(
  name: string,
  {
    folderId = null,
    createdAt = 0,
    lastConnectionAt = null,
  }: {
    folderId?: string | null
    createdAt?: number
    lastConnectionAt?: number | null
  } = {}
): PlacedRoom & { id: string } {
  return { id: name, name, folderId, createdAt, lastConnectionAt }
}

describe("sortFolders", () => {
  describe("updated", () => {
    it("orders folders by updatedAt, most recent first", () => {
      const folders = [
        folder("old", { updatedAt: 150 }),
        folder("newest", { updatedAt: 900 }),
        folder("middle", { updatedAt: 500 }),
      ]
      const ordered = sortFolders(folders, "updated").map((f) => f.name)
      expect(ordered).toEqual(["newest", "middle", "old"])
    })

    it("ranks a never-touched folder by its created timestamp", () => {
      // A folder's last-edited instant is its updatedAt, which on creation
      // equals createdAt — so a freshly-created folder still sorts by recency.
      const folders = [
        folder("stale", { createdAt: 100, updatedAt: 100 }),
        folder("fresh", { createdAt: 500, updatedAt: 500 }),
      ]
      const ordered = sortFolders(folders, "updated").map((f) => f.name)
      expect(ordered).toEqual(["fresh", "stale"])
    })
  })

  describe("created", () => {
    it("orders folders by created timestamp, newest first", () => {
      const folders = [
        folder("b", { createdAt: 200 }),
        folder("c", { createdAt: 300 }),
        folder("a", { createdAt: 100 }),
      ]
      const ordered = sortFolders(folders, "created").map((f) => f.name)
      expect(ordered).toEqual(["c", "b", "a"])
    })
  })

  describe("name", () => {
    it("orders folders alphabetically, locale-aware", () => {
      const folders = [folder("charlie"), folder("alpha"), folder("bravo")]
      const ordered = sortFolders(folders, "name", "asc").map((f) => f.name)
      expect(ordered).toEqual(["alpha", "bravo", "charlie"])
    })

    it("flips to Z→A when descending", () => {
      const folders = [folder("alpha"), folder("charlie"), folder("bravo")]
      const ordered = sortFolders(folders, "name", "desc").map((f) => f.name)
      expect(ordered).toEqual(["charlie", "bravo", "alpha"])
    })
  })

  it("defaults to descending", () => {
    const folders = [
      folder("a", { createdAt: 100 }),
      folder("c", { createdAt: 300 }),
      folder("b", { createdAt: 200 }),
    ]
    const ordered = sortFolders(folders, "created").map((f) => f.name)
    expect(ordered).toEqual(["c", "b", "a"])
  })

  it("does not mutate the input list", () => {
    const folders = [
      folder("b", { createdAt: 200 }),
      folder("a", { createdAt: 100 }),
    ]
    sortFolders(folders, "created")
    expect(folders.map((f) => f.name)).toEqual(["b", "a"])
  })
})

describe("foldersInParent", () => {
  it("returns only the folders directly under the given parent, sorted", () => {
    const folders = [
      folder("root-b", { createdAt: 200 }),
      folder("child-x", { parentFolderId: "root-a", createdAt: 50 }),
      folder("root-a", { createdAt: 100 }),
      folder("child-y", { parentFolderId: "root-a", createdAt: 90 }),
    ]

    const roots = foldersInParent(folders, null, "created").map((f) => f.name)
    expect(roots).toEqual(["root-b", "root-a"])

    const children = foldersInParent(folders, "root-a", "created").map(
      (f) => f.name
    )
    expect(children).toEqual(["child-y", "child-x"])
  })

  it("returns the top-level folders when partitioning at the root", () => {
    const folders = [
      folder("alpha", { parentFolderId: null }),
      folder("nested", { parentFolderId: "alpha" }),
    ]
    const roots = foldersInParent(folders, null, "name", "asc").map(
      (f) => f.name
    )
    expect(roots).toEqual(["alpha"])
  })

  it("is empty for a parent with no children", () => {
    const folders = [folder("alpha"), folder("beta")]
    expect(foldersInParent(folders, "alpha", "name")).toEqual([])
  })
})

describe("ancestorChain", () => {
  // a > b > c, plus an unrelated root.
  const tree = [
    folder("a"),
    folder("b", { parentFolderId: "a" }),
    folder("c", { parentFolderId: "b" }),
    folder("other"),
  ]

  it("is empty at the root", () => {
    expect(ancestorChain(tree, null)).toEqual([])
  })

  it("returns a single-element chain for a top-level folder", () => {
    expect(ancestorChain(tree, "a").map((f) => f.id)).toEqual(["a"])
  })

  it("walks parentFolderId up to the root, ordered root→current", () => {
    expect(ancestorChain(tree, "c").map((f) => f.id)).toEqual(["a", "b", "c"])
  })

  it("ends with the current folder as the last crumb", () => {
    const chain = ancestorChain(tree, "b")
    expect(chain.map((f) => f.id)).toEqual(["a", "b"])
    expect(chain[chain.length - 1]!.id).toBe("b")
  })

  it("returns an empty chain for an unknown id", () => {
    expect(ancestorChain(tree, "missing")).toEqual([])
  })

  it("terminates on a corrupt parent cycle instead of looping", () => {
    const cyclic = [
      folder("x", { parentFolderId: "y" }),
      folder("y", { parentFolderId: "x" }),
    ]
    const chain = ancestorChain(cyclic, "x").map((f) => f.id)
    // Both folders appear once; no infinite loop.
    expect(chain.sort()).toEqual(["x", "y"])
  })
})

describe("roomsInFolder", () => {
  it("returns only the Rooms filed into the given folder, sorted", () => {
    const rooms = [
      placedRoom("root-old", { createdAt: 100 }),
      placedRoom("in-a-new", { folderId: "a", createdAt: 300 }),
      placedRoom("in-a-old", { folderId: "a", createdAt: 200 }),
      placedRoom("in-b", { folderId: "b", createdAt: 400 }),
    ]
    const inA = roomsInFolder(rooms, "a", "created").map((r) => r.name)
    expect(inA).toEqual(["in-a-new", "in-a-old"])
  })

  it("treats a null folderId as the user's root", () => {
    const rooms = [
      placedRoom("root-a", { createdAt: 100 }),
      placedRoom("filed", { folderId: "a", createdAt: 200 }),
      placedRoom("root-b", { createdAt: 300 }),
    ]
    const atRoot = roomsInFolder(rooms, null, "created").map((r) => r.name)
    expect(atRoot).toEqual(["root-b", "root-a"])
  })

  it("is empty for a folder with no Rooms", () => {
    const rooms = [placedRoom("filed", { folderId: "a" })]
    expect(roomsInFolder(rooms, "b", "name")).toEqual([])
  })
})
