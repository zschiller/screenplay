import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { createFiles, memoryFileIndex, type Files } from "./files"
import { mirrorFolderName, syncFileMirror } from "./mirror"
import { memoryFileStore } from "./store"

const author = { addedBy: "agent", addedById: "chat-1" } as const
const save = (files: Files, path: string, text: string, now = 1_000) =>
  files.save({
    path,
    bytes: new TextEncoder().encode(text),
    fallbackMediaType: "text/plain",
    author,
    now,
  })

/** Every file and folder under `dir`, relative, sorted. */
async function tree(dir: string): Promise<string[]> {
  const items = await readdir(dir, { recursive: true, withFileTypes: true })
  return items
    .map((i) => join(i.parentPath, i.name).slice(dir.length + 1))
    .sort()
}

describe("syncFileMirror", () => {
  let dir: string
  let files: Files
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "mirror-"))
    files = createFiles({
      index: memoryFileIndex(),
      store: memoryFileStore(),
      keyPrefix: "canvas/room-1",
    })
  })
  afterEach(() => rm(dir, { recursive: true, force: true }))

  it("writes the files under their own names and folders", async () => {
    await save(files, "research/notes.md", "# Notes")
    await files.makeFolder("empty", author)

    await syncFileMirror(files, dir)

    expect(await tree(dir)).toEqual(["empty", "research", "research/notes.md"])
    expect(await readFile(join(dir, "research/notes.md"), "utf8")).toBe(
      "# Notes"
    )
  })

  it("follows saves, moves and deletes, and drops anything else", async () => {
    await save(files, "a.md", "one")
    await save(files, "b.md", "gone soon")
    await syncFileMirror(files, dir)
    await writeFile(join(dir, "stray.txt"), "made by hand")

    await save(files, "a.md", "two", 2_000)
    await files.move("a.md", "kept/a.md")
    await files.remove("b.md")
    await syncFileMirror(files, dir)

    expect(await tree(dir)).toEqual(["kept", "kept/a.md"])
    expect(await readFile(join(dir, "kept/a.md"), "utf8")).toBe("two")
  })
})

describe("mirrorFolderName", () => {
  it("names the canvas, safe for a folder, and unique by its id", () => {
    expect(mirrorFolderName("Q3 / launch: plan", "abc")).toBe(
      "Q3 - launch- plan (abc)"
    )
    expect(mirrorFolderName("..", "abc")).toBe("Untitled (abc)")
  })
})
