import { describe, expect, it } from "vitest"

import type { FileTreeNode } from "@/lib/files/tree"
import type { FileEntryData } from "@/lib/types"

import { deleteDescription } from "./canvas-files-section"

const node = (
  path: string,
  kind: FileEntryData["kind"] = "file",
  descendants = 0
): FileTreeNode => ({
  entry: { path, kind } as FileEntryData,
  name: path.split("/").pop()!,
  children: [],
  descendants,
})

describe("deleteDescription", () => {
  it("says what breaks when an upload goes", () => {
    expect(deleteDescription(node("uploads/shot.png"))).toBe(
      "Chats on this canvas can no longer open it. Documents and messages that show it lose it. You can’t undo this."
    )
  })

  it("says it for the uploads folder too", () => {
    expect(deleteDescription(node("uploads", "folder", 2))).toBe(
      "The 2 items in it go too, and chats on this canvas can no longer open them. Documents and messages that show them lose them. You can’t undo this."
    )
  })

  it("leaves other files as they were", () => {
    expect(deleteDescription(node("notes/uploads.png"))).toBe(
      "Chats on this canvas can no longer open it. You can’t undo this."
    )
  })
})
