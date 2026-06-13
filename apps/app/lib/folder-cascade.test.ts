import { describe, expect, it } from "vitest"
import {
  collectFolderCascade,
  descendantFolderIds,
  type CascadeFolder,
  type CascadeRoom,
} from "@/lib/folder-cascade"

// A small tree used across the cascade tests:
//
//   root
//   ├── a
//   │   ├── a1
//   │   └── a2
//   └── b
//   other            (a separate branch the cascade must never touch)
//   └── other1
const tree: CascadeFolder[] = [
  { id: "root", parentFolderId: null },
  { id: "a", parentFolderId: "root" },
  { id: "b", parentFolderId: "root" },
  { id: "a1", parentFolderId: "a" },
  { id: "a2", parentFolderId: "a" },
  { id: "other", parentFolderId: null },
  { id: "other1", parentFolderId: "other" },
]

function room(over: Partial<CascadeRoom> & { roomId: string }): CascadeRoom {
  return { folderId: "root", isOwner: true, sharedWithCount: 0, ...over }
}

describe("descendantFolderIds", () => {
  it("returns the target plus every descendant, any depth", () => {
    const ids = descendantFolderIds("root", tree)
    expect(new Set(ids)).toEqual(new Set(["root", "a", "b", "a1", "a2"]))
    // The unrelated branch is never included.
    expect(ids).not.toContain("other")
    expect(ids).not.toContain("other1")
  })

  it("includes only the target when it has no children (a leaf)", () => {
    expect(descendantFolderIds("a1", tree)).toEqual(["a1"])
  })

  it("includes the target even when it isn't in the folder list", () => {
    // Deleting a folder the snapshot doesn't carry still removes that folder.
    expect(descendantFolderIds("ghost", tree)).toEqual(["ghost"])
  })

  it("terminates on a corrupt parent cycle instead of looping", () => {
    const cyclic: CascadeFolder[] = [
      { id: "x", parentFolderId: "y" },
      { id: "y", parentFolderId: "x" },
    ]
    expect(new Set(descendantFolderIds("x", cyclic))).toEqual(
      new Set(["x", "y"])
    )
  })
})

describe("collectFolderCascade", () => {
  it("enumerates exactly the branch's folders and owned Rooms", () => {
    const rooms: CascadeRoom[] = [
      room({ roomId: "r-a1", folderId: "a1" }),
      room({ roomId: "r-a", folderId: "a" }),
      room({ roomId: "r-b", folderId: "b" }),
      // Rooms outside the deleted branch are left untouched.
      room({ roomId: "r-other", folderId: "other1" }),
    ]

    const cascade = collectFolderCascade("a", tree, rooms)

    expect(new Set(cascade.folderIds)).toEqual(new Set(["a", "a1", "a2"]))
    // Only the Rooms placed under a / a1 / a2 are torn down.
    expect(new Set(cascade.teardownRoomIds)).toEqual(new Set(["r-a1", "r-a"]))
    expect(cascade.leaveRoomIds).toEqual([])
    expect(cascade.deletedCount).toBe(2)
  })

  it("partitions Rooms by the shared deletion rule", () => {
    const rooms: CascadeRoom[] = [
      // Solely owned → hard delete (teardown).
      room({ roomId: "owned", folderId: "a", isOwner: true }),
      // Shared, owned → delete-for-all (still a teardown, counts the people).
      room({
        roomId: "shared-owned",
        folderId: "a1",
        isOwner: true,
        sharedWithCount: 3,
      }),
      // Shared, not owned → the user leaves; the Room is untouched for others.
      room({
        roomId: "shared-guest",
        folderId: "a2",
        isOwner: false,
        sharedWithCount: 2,
      }),
    ]

    const cascade = collectFolderCascade("a", tree, rooms)

    expect(new Set(cascade.teardownRoomIds)).toEqual(
      new Set(["owned", "shared-owned"])
    )
    expect(cascade.leaveRoomIds).toEqual(["shared-guest"])
    // Two canvases permanently deleted; one of them is a shared owned Room.
    expect(cascade.deletedCount).toBe(2)
    expect(cascade.sharedOwnedCount).toBe(1)
    expect(cascade.sharedWithCount).toBe(3)
  })

  it("sums the people across several shared owned Rooms", () => {
    const rooms: CascadeRoom[] = [
      room({ roomId: "s1", folderId: "a", isOwner: true, sharedWithCount: 2 }),
      room({ roomId: "s2", folderId: "a2", isOwner: true, sharedWithCount: 4 }),
    ]

    const cascade = collectFolderCascade("a", tree, rooms)

    expect(cascade.sharedOwnedCount).toBe(2)
    expect(cascade.sharedWithCount).toBe(6)
  })

  it("is a clean recursive delete when nothing is shared (local build)", () => {
    const rooms: CascadeRoom[] = [
      room({ roomId: "r1", folderId: "a" }),
      room({ roomId: "r2", folderId: "a1" }),
    ]

    const cascade = collectFolderCascade("a", tree, rooms)

    expect(cascade.teardownRoomIds.sort()).toEqual(["r1", "r2"])
    expect(cascade.leaveRoomIds).toEqual([])
    expect(cascade.sharedOwnedCount).toBe(0)
    expect(cascade.sharedWithCount).toBe(0)
  })

  it("reports an empty branch with no canvases to delete", () => {
    // Deleting a folder whose only content is empty sub-folders.
    const cascade = collectFolderCascade("b", tree, [])
    expect(cascade.folderIds).toEqual(["b"])
    expect(cascade.deletedCount).toBe(0)
    expect(cascade.teardownRoomIds).toEqual([])
    expect(cascade.leaveRoomIds).toEqual([])
  })
})
