import { describe, expect, it } from "vitest"
import { planFileDrop, type FileDragItem } from "./file-dnd"
import type { CascadeFolder } from "./folder-cascade"

// a > b > c, plus an unrelated sibling tree at the root.
const folders: CascadeFolder[] = [
  { id: "a", parentFolderId: null },
  { id: "b", parentFolderId: "a" },
  { id: "c", parentFolderId: "b" },
  { id: "e", parentFolderId: null },
]

const room = (currentParentId: string | null): FileDragItem => ({
  kind: "room",
  id: "r1",
  name: "Sketch",
  currentParentId,
})

const folder = (id: string, currentParentId: string | null): FileDragItem => ({
  kind: "folder",
  id,
  name: id,
  currentParentId,
})

describe("planFileDrop", () => {
  it("files a canvas into the folder it's dropped on", () => {
    expect(planFileDrop(room(null), "a", folders)).toEqual({
      kind: "room",
      id: "r1",
      targetId: "a",
    })
  })

  it("re-parents a folder dropped onto another folder", () => {
    expect(planFileDrop(folder("e", null), "a", folders)).toEqual({
      kind: "folder",
      id: "e",
      targetId: "a",
    })
  })

  it("rejects dropping a folder onto itself (cycle)", () => {
    expect(planFileDrop(folder("a", null), "a", folders)).toBeNull()
  })

  it("rejects dropping a folder onto one of its descendants (cycle)", () => {
    // "a" is the root of a > b > c; landing it on "c" would invert the branch.
    expect(planFileDrop(folder("a", null), "c", folders)).toBeNull()
  })

  it("is a no-op when dropped where it already lives", () => {
    expect(planFileDrop(room("a"), "a", folders)).toBeNull()
    expect(planFileDrop(folder("b", "a"), "a", folders)).toBeNull()
  })

  it("files a canvas back to the root when dropped on 'All files'", () => {
    expect(planFileDrop(room("a"), null, folders)).toEqual({
      kind: "room",
      id: "r1",
      targetId: null,
    })
  })

  it("re-parents a folder to the root — never a cycle", () => {
    // "b" lives under "a"; dropping it on the root pulls it to the top level.
    expect(planFileDrop(folder("b", "a"), null, folders)).toEqual({
      kind: "folder",
      id: "b",
      targetId: null,
    })
  })

  it("is a no-op when a root-level item is dropped on the root", () => {
    expect(planFileDrop(room(null), null, folders)).toBeNull()
    expect(planFileDrop(folder("e", null), null, folders)).toBeNull()
  })
})
