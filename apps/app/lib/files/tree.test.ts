import { describe, expect, it } from "vitest"

import type { FileEntryData } from "@/lib/types"
import { fileTree, itemCount, type FileTreeNode } from "./tree"

const entry = (path: string, kind: FileEntryData["kind"] = "file") =>
  ({
    id: path,
    path,
    kind,
    size: kind === "file" ? 10 : 0,
    mediaType: kind === "file" ? "text/plain" : "",
    addedBy: "agent",
    addedById: "chat-1",
    blobKey: "",
    createdAt: 1,
    updatedAt: 1,
  }) satisfies FileEntryData

/** The tree as indented names, with each folder's descendant count. */
const outline = (nodes: FileTreeNode[], depth = 0): string[] =>
  nodes.flatMap((n) => [
    `${"  ".repeat(depth)}${n.name}${n.entry.kind === "folder" ? `/ (${n.descendants})` : ""}`,
    ...outline(n.children, depth + 1),
  ])

describe("fileTree", () => {
  it("nests contents under their folder, folders first, then by name", () => {
    const tree = fileTree([
      entry("b.md"),
      entry("research/z.md"),
      entry("research", "folder"),
      entry("a.md"),
      entry("research/deep", "folder"),
      entry("research/deep/file10.md"),
      entry("research/deep/file9.md"),
      entry("empty", "folder"),
    ])

    expect(outline(tree)).toEqual([
      "empty/ (0)",
      "research/ (4)",
      "  deep/ (2)",
      "    file9.md",
      "    file10.md",
      "  z.md",
      "a.md",
      "b.md",
    ])
  })

  it("keeps a file whose folder has no entry, under a folder made for it", () => {
    expect(outline(fileTree([entry("lost/inner/x.md")]))).toEqual([
      "lost/ (2)",
      "  inner/ (1)",
      "    x.md",
    ])
  })
})

describe("itemCount", () => {
  it("counts in words", () => {
    expect([0, 1, 2].map(itemCount)).toEqual(["Empty", "1 item", "2 items"])
  })
})
